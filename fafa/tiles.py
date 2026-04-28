"""地图瓦片预设。

可用样式：
  amap             高德地图（彩色，GCJ-02）
  light            CartoDB Positron 浅色（含标注，WGS-84）
  light-nolabels   CartoDB Positron 浅色路网（无标注，WGS-84）
  dark             CartoDB Dark Matter 深色（含标注，WGS-84）
  dark-nolabels    CartoDB Dark Matter 深色路网（无标注，WGS-84）
"""

import folium

STYLES = list[str]

PRESETS: dict[str, dict] = {
    "amap": {
        "url": (
            "https://webrd0{s}.is.autonavi.com/appmaptile"
            "?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}"
        ),
        "crs": "gcj02",
        "attr": '&copy; <a href="https://www.amap.com/">高德地图</a>',
        "subdomains": "1234",
        "name": "高德地图",
    },
    "light": {
        "url": "https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png",
        "crs": "wgs84",
        "attr": '&copy; <a href="https://carto.com/">CARTO</a>',
        "subdomains": "abcd",
        "name": "浅色地图",
    },
    "light-nolabels": {
        "url": "https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_nolabels/{z}/{x}/{y}.png",
        "crs": "wgs84",
        "attr": '&copy; <a href="https://carto.com/">CARTO</a>',
        "subdomains": "abcd",
        "name": "浅色路网（无标注）",
    },
    "dark": {
        "url": "https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png",
        "crs": "wgs84",
        "attr": '&copy; <a href="https://carto.com/">CARTO</a>',
        "subdomains": "abcd",
        "name": "深色地图",
    },
    "dark-nolabels": {
        "url": "https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_nolabels/{z}/{x}/{y}.png",
        "crs": "wgs84",
        "attr": '&copy; <a href="https://carto.com/">CARTO</a>',
        "subdomains": "abcd",
        "name": "深色路网（无标注）",
    },
}

STYLE_CHOICES = list(PRESETS.keys())


def tile_crs(style: str) -> str:
    return PRESETS[style]["crs"]


def make_map(center: tuple[float, float], zoom: int = 14, style: str = "amap") -> folium.Map:
    p = PRESETS[style]
    m = folium.Map(location=center, zoom_start=zoom, tiles=None)
    folium.TileLayer(
        tiles=p["url"],
        attr=p["attr"],
        name=p["name"],
        subdomains=p.get("subdomains", "abc"),
        max_zoom=19,
    ).add_to(m)
    return m
