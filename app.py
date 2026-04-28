#!/usr/bin/env python3
"""FAFA Track Viewer — Flask 开发服务器

启动:
    .venv/bin/python app.py
然后访问 http://localhost:5173
"""

import os
import tempfile
from dataclasses import asdict
from flask import Flask, render_template, request, jsonify
from fafa.parser import parse_fit
from fafa.gcj02 import needs_wgs84_conversion
from fafa.stats import compute_km_stats, compute_summary

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB

SEMICIRCLE_TO_DEG = 180.0 / (2 ** 31)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/upload", methods=["POST"])
def upload():
    f = request.files.get("file")
    if not f:
        return jsonify(error="未收到文件"), 400
    if not f.filename.lower().endswith(".fit"):
        return jsonify(error="请上传 .fit 格式文件"), 400

    with tempfile.NamedTemporaryFile(suffix=".fit", delete=False) as tmp:
        f.save(tmp.name)
        tmp_path = tmp.name

    try:
        fit = parse_fit(tmp_path)
    except Exception as e:
        return jsonify(error=f"解析失败: {e}"), 422
    finally:
        os.unlink(tmp_path)

    coords = [
        [r.position_lat * SEMICIRCLE_TO_DEG, r.position_long * SEMICIRCLE_TO_DEG]
        for r in fit.records
        if r.position_lat is not None and r.position_long is not None
    ]
    if not coords:
        return jsonify(error="该文件没有 GPS 数据"), 422

    try:
        km_stats = compute_km_stats(fit)
        summary  = compute_summary(fit, km_stats)
        summary_dict  = asdict(summary)
        km_stats_list = [asdict(s) for s in km_stats]
    except Exception:
        summary_dict  = None
        km_stats_list = []

    return jsonify(
        coords=coords,
        filename=f.filename,
        is_gcj02=not needs_wgs84_conversion(fit.manufacturer),
        summary=summary_dict,
        km_stats=km_stats_list,
    )


if __name__ == "__main__":
    app.run(debug=True, port=5173)
