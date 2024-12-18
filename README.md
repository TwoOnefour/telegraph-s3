# Description
这是一个使用**cloudflare worker**搭建的**telegram**无限图床

本仓库代码由[telegraph](https://github.com/0-RTT/telegraph)项目修改而来

特点如下
- 兼容S3上传api
- 可以指定回源S3实现无缝迁移图床
- 可以通过picgo填入S3 key上传图片

# Deploy
**首先克隆本仓库**
> git clone https://github.com/twoonefour/telegraph-s3.git

下载`cloudflare wrangler`环境
> npm install wrangler -g

下载依赖
> npm install 
## wrangler.toml
编辑`wrangler.toml`
```
[vars]
enableOriginS3 = true # 如果不想开启回源可以设置为false
S3_ENDPOINT = ""  # 填入S3回源endpoint
S3_BUCKET_NAME = "" # 填入S3回源存储桶
S3_REGION = "" # 填入S3 region
S3_ACCESS_KEY_ID = "" # 填入S3 key id
TG_CHAT_ID= "" # 填入TG频道id

[[d1_databases]]
binding = "DB" # 不要改动
database_name = "" # 填入你在cloudflare创建的d1数据库名称
database_id = "xxxx-xxxx-xxxx-xxx-xxxxx" # 填入你在cloudflare创建的d1数据库id
```

填写`TG_BOT_TOKEN`密钥，这是你的tg机器人密钥
> npx wrangler secret put TG_BOT_TOKEN

填写`S3_SECRET_ACCESS_KEY`，这是你的s3存储桶密钥
> npx wrangler secret put S3_SECRET_ACCESS_KEY

最后部署即可
> npx wrangler deploy

# 使用pic-go上传
默认pic-go使用[picgo-plugin-s3](https://github.com/wayjam/picgo-plugin-s3)

有两种方式
1. 直接上传至`telegram`
2. 上传至你的存储桶. 通过worker url访问则会自动回源上传至`telegram`

## 第一种
填写的配置与你在wrangler中填写的s3配置相同，**不同的是自定义节点与自定义域名和桶名**
![示例](https://bucket.voidval.com/upload/2024/12/880ae067954c06b380d2de728d0ba078.png)

如图，若你的worker部署域名是`https://bucket.example.com`，你的自定义节点则是`https://example.com`(由于s3 api协议会在example.com前面添加桶的名字)

**这里的桶名是用于指向worker域名的，与你在`wrangler.toml`中填写的无任何关系，`wrangler.toml`中填写的只用于回源，上传只会验证你的key和secret_key是否相同**

## 第二种
直接上传至你的回源存储桶，worker对应的uri就是你的图片地址,不需要特别操作

如你上传了`/upload/example.png`
你的worker域名是`bucket1.example.com`
则你的图片地址就是`https://bucket1.example.com/upload/example.png`

# 致谢
[telegraph](https://github.com/0-RTT/telegraph)
