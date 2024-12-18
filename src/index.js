import { SHA256, enc, HmacSHA256 } from 'crypto-js';
import {
  S3Client,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import {createHash} from 'node:crypto';

export default {
	async fetch(request, env, ctx) {
		const { pathname } = new URL(request.url);
		switch (request.method) {
			case 'GET':
				return await getImageHandler(request, env, ctx);
			case 'POST':
				return await UploadImageHandler(request, env);
			case 'PUT':
				return await UploadImageHandler(request, env);
			default:
				return new Response("Not Permitted");
		}
	}
}

async function S3Signv4(request, env){
	const timeStampISO8601Format = request.headers.get("x-amz-date");
	const timeStamp = request.headers.get("x-amz-date").substring(0, 8);
	const authorization = request.headers.get("Authorization").split(" ");
	let algorithm = authorization[0];
	let Credential = authorization[1].split("=").pop().slice(0, -1);
	let SignedHeaders = authorization[2].split("=").pop().slice(0, -1);
	let tmpCredential = Credential.split('/');
	let key_id = tmpCredential.shift();
	let auth_msg = tmpCredential;
	let region = auth_msg[1];
	let service = auth_msg[2];
	const apiVersion = auth_msg[3];

	if (key_id !== env.S3_ACCESS_KEY_ID) return new Response("S3密钥认证错误", {status:400});
	const url = new URL(request.url);
	const CanonicalURI = url.pathname;
	const fileName = url.pathname.split('/').pop()
	const HTTPMethod = request.method;

	const CanonicalQueryString = ((url) => {
		const param = url.searchParams;
		let str = "";
		let sortedNameArr = [];
		for(const [key, value] of  param){
			sortedNameArr.push([key, value]);
		}
		sortedNameArr = sortedNameArr.sort((a, b) => a[0] - b[0]);
		let tmp = [];
		for(const i of sortedNameArr){
			tmp.push(encodeURIComponent(i[0]) + "=" + encodeURIComponent(i[1]));
		}
		return tmp.join("&");
	})(url);
	const CanonicalHeaders = ((header, headerKey) =>
	{
			let result = [];
			for(const [key, value] of header)
				if (headerKey.has(key))
    			result.push([key, value]);
			result = result.sort((a, b) => a[0] - b[0]);
			let tmp = [];
			for(let i of result){
				tmp.push(`${i[0].toLowerCase()}:${i[1].trim()}`);
			}
			return tmp.join("\n");
	})(request.headers, new Set(SignedHeaders.split(";")));
	const reader1 = request.body.getReader();

	const pic_data1 = [];
	const hash = createHash('sha256');
	while (true) {
		const { done, value } = await reader1.read();
		if (done) {
			break;
		}
		pic_data1.push(value);
		hash.update(value);
	}

	const FileBlob = new File(pic_data1, fileName, {type: request.headers.get("content-type")});

	const receivePayLoad = hash.digest('hex');
	const HashedPayload = request.headers.get("x-amz-content-sha256");
	if (HashedPayload !== receivePayLoad) return new Response("S3密钥认证错误", {status:400});
	const canonicalRequest = `${HTTPMethod}\n` +
																	`${CanonicalURI}\n` +
																	`${CanonicalQueryString}\n` +
																	`${CanonicalHeaders}\n\n` +
																	`${SignedHeaders}\n` +
																	`${HashedPayload}`

	const stringToSign = algorithm + "\n" +
		timeStampISO8601Format + "\n" +
		`${timeStamp}/${env.S3_REGION}/s3/aws4_request` + "\n" +
		SHA256(canonicalRequest).toString(enc.Hex);


	const DateKey = HmacSHA256( timeStamp, `AWS4${env.S3_SECRET_ACCESS_KEY}`,);
	const DateRegionKey = HmacSHA256(region, DateKey);
	const DateRegionServiceKey = HmacSHA256( service, DateRegionKey);
	const SigningKey = HmacSHA256( apiVersion, DateRegionServiceKey);
	const Signature = HmacSHA256( stringToSign, SigningKey).toString(enc.Hex);

	// const AuthorizationHeader = `Authorization: ${algorithm} ` +
	// 																	`Credential=${Credential}, ` +
	// 																	`SignedHeaders=${SignedHeaders}, ` +
	// 																	`Signature=${Signature}`;
	if (authorization[3].split("=").pop() !== Signature)
		return new Response("S3密钥认证错误", {status:400})

	const fileId = await UploadImage(env, FileBlob);
	await env.DB.prepare('INSERT INTO media (url, fileId) VALUES (?, ?) ON CONFLICT(url) DO NOTHING').bind( url.origin + url.pathname, fileId).run();
	const responseToCache = new Response("ok", { status: 200, headers: {"content-type": request.headers.get("content-type")} });
	return responseToCache;
}


async function UploadImageHandler(request, env){
	return await S3Signv4(request, env);
}

async function checkIfNeedUpdate(request, env, ctx){
	// if db not match, update the cache and reload object from other place
	const {origin, pathname} = new URL(request.url);
	const cacheKey = new Request(request.url);
	const result = await env.DB.prepare('SELECT url, fileId FROM media WHERE url = ?').bind(origin + pathname).first();
	if (!result){
		 await caches.default.delete(cacheKey);
		 await getImageHandler(request, env, ctx); // it won't loop because cache has been deleted;
	}
}

async function getImageHandler(request, env, ctx){
		const cache = caches.default;
		const { pathname, origin } = new URL(request.url);
		let patharr = pathname.split("/");
		const prefix = pathname.split("/").slice(0, pathname.split("/").length - 1).join("/");
		patharr.shift();
		const cacheKey = new Request(request.url);
		const cachedResponse = await cache.match(cacheKey);
		if (cachedResponse){
			ctx.waitUntil(checkIfNeedUpdate(request, env, ctx));
			return cachedResponse;
		}
		const key = pathname.substring(1, pathname.length);
		// Specify the object key
		const objectKey = key;
		if (!objectKey) return new Response("不允许的键", { status: 404 })
		const result = await env.DB.prepare('SELECT url, fileId FROM media WHERE url = ?').bind(origin + pathname).first();
		if (!result) {
			 if (!env.enableOriginS3){
						const notFoundResponse = new Response('资源不存在', { status: 404 });
						await cache.put(cacheKey, notFoundResponse.clone());
						return notFoundResponse;
			 }

			 return findInS3(request.url, env, objectKey, ctx);
		}

		return getImage(request.url, env, result.fileId);

}

async function getImage(requestUrl, env, fileId){
	const cache = caches.default;
	const cacheKey = new Request(requestUrl);
  let filePath;
  let attempts = 0;
  const maxAttempts = 3;
  while (attempts < maxAttempts) {
    const getFilePath = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/getFile?file_id=${fileId}`);
    if (!getFilePath.ok) {
      return new Response('getFile请求失败', { status: 500 });
    }
    const fileData = await getFilePath.json();
    if (fileData.ok && fileData.result.file_path) {
      filePath = fileData.result.file_path;
      break;
    }
    attempts++;
  }
  if (!filePath) {
    const notFoundResponse = new Response('未找到FilePath', { status: 404 });
    await cache.put(cacheKey, notFoundResponse.clone());
    return notFoundResponse;
  }
  const getFileResponse = `https://api.telegram.org/file/bot${env.TG_BOT_TOKEN}/${filePath}`;
  const response = await fetch(getFileResponse);
  if (!response.ok) {
    return new Response('获取文件内容失败', { status: 500 });
  }
  const fileExtension = requestUrl.split('.').pop().toLowerCase();
  let contentType = 'text/plain; charset=utf-8;';
  if (fileExtension === 'jpg' || fileExtension === 'jpeg') contentType = 'image/jpeg';
  if (fileExtension === 'png') contentType = 'image/png';
  if (fileExtension === 'gif') contentType = 'image/gif';
  if (fileExtension === 'webp') contentType = 'image/webp';
  if (fileExtension === 'mp4') contentType = 'video/mp4';
  const headers = new Headers(response.headers);
  headers.set('Content-Type', contentType);
  headers.set('Content-Disposition', 'inline');
  const responseToCache = new Response(response.body, { status: response.status, headers });
  await cache.put(cacheKey, responseToCache.clone());
  return responseToCache;
}

async function UploadImage(env, file){
		const uploadFormData = new FormData();
    uploadFormData.append("chat_id", env.TG_CHAT_ID);
    let fileId;
    if (file.type.startsWith('image/gif')) {
      const newFileName = file.name.replace(/\.gif$/, '.jpeg');
      const newFile = new File([file], newFileName, { type: 'image/jpeg' });
      uploadFormData.append("document", newFile);
    } else {
      uploadFormData.append("document", file);
    }
    const telegramResponse = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendDocument`, { method: 'POST', body: uploadFormData });

		if (!telegramResponse.ok) {
      const errorData = await telegramResponse.json();
      throw new Error(errorData.description || '上传到 Telegram 失败');
    }

    const responseData = await telegramResponse.json();
    if (responseData.result.video) fileId = responseData.result.video.file_id;
    else if (responseData.result.document) fileId = responseData.result.document.file_id;
    else if (responseData.result.sticker) fileId = responseData.result.sticker.file_id;
    else throw new Error('返回的数据中没有文件 ID');
    // const fileExtension = file.name.split('.').pop();
    // const timestamp = Date.now();
    // const imageURL = `https://${env.DOMAIN}/${timestamp}.${fileExtension}`;
		return fileId;
}

async function findInS3(requestUrl, env, objectKey, ctx){
			const s3_endpoint = env.S3_ENDPOINT;
			const s3_bucket_name = env.S3_BUCKET_NAME;
			const s3_region = env.S3_REGION;
			const ACCESS_KEY_ID = env.S3_ACCESS_KEY_ID;
			const SECRET_ACCESS_KEY = env.S3_SECRET_ACCESS_KEY;
			const cache = caches.default;
			const cacheKey = new Request(requestUrl);
			let S3;
			try{
				S3 = new S3Client({
					region: s3_region,
					endpoint: `${s3_endpoint}`,
					credentials: {
						accessKeyId: ACCESS_KEY_ID,
						secretAccessKey: SECRET_ACCESS_KEY,
					},
				});
			} catch (err){
				 return new Response("S3 CONFIG ERROR.", {status: 500});
			}
			const params = {
				Bucket: s3_bucket_name,
				Key: decodeURI(objectKey).trim()
			};

			try{
				let response;
				let retryCount = 0;

				while (true){
						response = await S3.send(new GetObjectCommand(params));
						if (response.$metadata.httpStatusCode === 200) break;
						if (retryCount === 3 && response.$metadata.httpStatusCode !== 200) {
							const resp = new Response("从s3获取文件错误，请稍后再试");
							await cache.put(cacheKey, resp);
							return resp;
						}
						retryCount += 1;
				}

				const data = response.Body;
				if (response.ContentLength / 1024 / 1024 >= 20){
					// 存储桶中大于20MB不能上传tg，直接返回
					const headers = {
						"Content-Type": "binary/octet-stream"
					}
					return new Response(data, {status: response.status, headers});
				}

				const headers = {
					"Content-Type": response.ContentType
				}
				const reader = data.getReader();
				const pic_data = [];
				while (true) {
					const { done, value } = await reader.read();
					if (done) {
						break;
					}
					pic_data.push(value);
				}
				const file = new File(pic_data, objectKey, {type: response.ContentType});
				ctx.waitUntil(UploadImage(env, file).then(async (fileId) => {
						const {pathname, origin} = new URL(requestUrl);
						await env.DB.prepare('INSERT INTO media (url, fileId) VALUES (?, ?) ON CONFLICT(url) DO NOTHING').bind(origin + pathname, fileId).run();
				}))
				const responseToCache = new Response(file, { status: response.status, headers });
				await cache.put(cacheKey, responseToCache.clone());
				return responseToCache;
			} catch (error){
				console.log(error);
				const ErrorResponse = new Response(error, {status: 404});
				await cache.put(cacheKey, ErrorResponse.clone());
				return ErrorResponse;
			}
}
