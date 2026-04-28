"""WGS-84 ↔ GCJ-02（火星坐标系）转换工具。

GCJ-02 是中国国家标准坐标系，高德地图、腾讯地图等均使用该坐标系。
Garmin 等国际设备存储 WGS-84；Magene 等中国设备存储 GCJ-02。
"""

import math
from typing import Optional

_A = 6378245.0
_EE = 0.00669342162296594323

# 已知在 FIT 文件中以 GCJ-02 存储坐标的厂商（小写）
_GCJ02_MANUFACTURERS = {"magene"}


def _out_of_china(lat: float, lon: float) -> bool:
    return not (72.004 <= lon <= 137.8347 and 0.8293 <= lat <= 55.8271)


def _transform_lat(x: float, y: float) -> float:
    r = -100.0 + 2.0*x + 3.0*y + 0.2*y*y + 0.1*x*y + 0.2*math.sqrt(abs(x))
    r += (20.0*math.sin(6.0*x*math.pi) + 20.0*math.sin(2.0*x*math.pi)) * 2/3
    r += (20.0*math.sin(y*math.pi)     + 40.0*math.sin(y/3*math.pi))     * 2/3
    r += (160.0*math.sin(y/12*math.pi) + 320.0*math.sin(y*math.pi/30))   * 2/3
    return r


def _transform_lon(x: float, y: float) -> float:
    r = 300.0 + x + 2.0*y + 0.1*x*x + 0.1*x*y + 0.1*math.sqrt(abs(x))
    r += (20.0*math.sin(6.0*x*math.pi) + 20.0*math.sin(2.0*x*math.pi)) * 2/3
    r += (20.0*math.sin(x*math.pi)     + 40.0*math.sin(x/3*math.pi))     * 2/3
    r += (150.0*math.sin(x/12*math.pi) + 300.0*math.sin(x/30*math.pi))   * 2/3
    return r


def wgs84_to_gcj02(lat: float, lon: float) -> tuple[float, float]:
    """将 WGS-84 坐标转换为 GCJ-02。中国境外坐标原样返回。"""
    if _out_of_china(lat, lon):
        return lat, lon
    d_lat = _transform_lat(lon - 105.0, lat - 35.0)
    d_lon = _transform_lon(lon - 105.0, lat - 35.0)
    rad = lat / 180.0 * math.pi
    magic = math.sin(rad)
    magic = 1 - _EE * magic * magic
    sqrt_magic = math.sqrt(magic)
    d_lat = d_lat * 180.0 / ((_A * (1 - _EE)) / (magic * sqrt_magic) * math.pi)
    d_lon = d_lon * 180.0 / (_A / sqrt_magic * math.cos(rad) * math.pi)
    return lat + d_lat, lon + d_lon


def gcj02_to_wgs84(lat: float, lon: float) -> tuple[float, float]:
    """将 GCJ-02 坐标近似还原为 WGS-84（误差 < 1m，足够地图展示）。"""
    if _out_of_china(lat, lon):
        return lat, lon
    d_lat = _transform_lat(lon - 105.0, lat - 35.0)
    d_lon = _transform_lon(lon - 105.0, lat - 35.0)
    rad = lat / 180.0 * math.pi
    magic = math.sin(rad)
    magic = 1 - _EE * magic * magic
    sqrt_magic = math.sqrt(magic)
    d_lat = d_lat * 180.0 / ((_A * (1 - _EE)) / (magic * sqrt_magic) * math.pi)
    d_lon = d_lon * 180.0 / (_A / sqrt_magic * math.cos(rad) * math.pi)
    return lat - d_lat, lon - d_lon


def needs_wgs84_conversion(manufacturer: Optional[str]) -> bool:
    """如果设备以 WGS-84 存储坐标（需要转换为 GCJ-02），返回 True。"""
    if manufacturer is None:
        return True  # 未知设备默认按 WGS-84 处理
    return manufacturer.lower() not in _GCJ02_MANUFACTURERS


def to_tile_coords(
    lat: float, lon: float,
    input_is_gcj02: bool,
    tile_crs: str,
) -> tuple[float, float]:
    """将坐标转换到瓦片坐标系。tile_crs: 'gcj02' 或 'wgs84'。"""
    if input_is_gcj02 and tile_crs == "wgs84":
        return gcj02_to_wgs84(lat, lon)
    if not input_is_gcj02 and tile_crs == "gcj02":
        return wgs84_to_gcj02(lat, lon)
    return lat, lon
