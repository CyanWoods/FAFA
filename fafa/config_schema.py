"""每用户配置（`user_config` 表，见 `fafa/auth.py`）的共享 schema 常量。

单一定义来源，供存储层（`fafa/auth.py`，负责类型还原/加解密）和路由层
（`app.py`，负责字段白名单校验）共用，避免两处各存一份定义、日后新增配置项
时漏改一处导致悄悄跑偏。
"""

# SQLite 里所有配置值都以 TEXT 存储；这些 key 读出时要转回数字（int/float）。
# 含 app.py `_CONFIG_NUMBER_RANGES` 里做范围校验的字段，以及 strava_expires_at
# ——它是 OAuth 只读字段、不在校验白名单里，但语义上仍是数字（Unix 时间戳）。
NUMBER_KEYS = frozenset({
    'pmc_ftp', 'pmc_rest_hr', 'pmc_max_hr', 'pmc_lthr', 'pmc_weight',
    'route_grade_min', 'route_grade_max', 'route_speed_max', 'route_cadence_max',
    'max_tokens', 'strava_redirect_port',
    'strava_expires_at',
})

# NUMBER_KEYS 的子集：还原成 int 而不是 float。
INT_KEYS = frozenset({'max_tokens', 'strava_redirect_port', 'strava_expires_at'})

# 存储时要加密的字段（与 app.py 原 `_SECRET_FIELDS` 一致）。
SECRET_KEYS = frozenset({
    'api_key', 'onelap_password', 'igpsport_password',
    'strava_client_secret', 'strava_access_token', 'strava_refresh_token',
})
