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

# 致谢
[telegraph](https://github.com/0-RTT/telegraph)
