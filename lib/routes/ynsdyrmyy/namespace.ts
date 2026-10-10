import type { Namespace } from '@/types';

export const namespace = 'ynsdyrmyy';

export default {
    name: '云南省第一人民医院 OA',
    description: '云南省第一人民医院 OA 系统（ynsdyrmyy.drp100.cn:7071）通知公告与公共文件柜，支持多栏目聚合',
    author: 'ydx1013',
    config: {
        YNSD_OA_COOKIE: {
            description: 'OA 登录后的 Authorization JWT（勾选"记住我"后有效期约 90 天，可用 login_refresh.py 续期）',
        },
    },
} as Namespace;
