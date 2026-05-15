# 拼豆像素图生成器

功能：上传图片、按标准拼豆板比例框选、生成 Mard 221 色带色号拼豆图纸。

当前版本特点：

- 无登录界面，打开即用。
- 不保存用户数据、历史记录、生成图片或数据库记录。
- 移动端支持拖动框选和四角缩放。
- 生成后可保存 PNG，也可下载 CSV 色号矩阵。
- 适配 Railway 部署。

## 本地运行

```bash
pip install -r requirements.txt
python run.py
```

浏览器打开：

```text
http://127.0.0.1:8000
```

## Railway 启动命令

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

项目中已包含 `railway.json` 和 `Procfile`。
