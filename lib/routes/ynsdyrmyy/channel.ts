// Usage:
//   /ynsdyrmyy/channel/cs69              single channel
//   /ynsdyrmyy/channel/cs69,cs5,cs15     multiple channels aggregated
//   /ynsdyrmyy/channel/all               all channels from my-menu (slow)
// Channel ids come from the my-menu API; see channels.tsv in the project folder.
import { load } from 'cheerio';
import type { Route } from '@/types';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import { config } from '@/config';

const BASE = 'https://ynsdyrmyy.drp100.cn:7071';
const API_LIST = `${BASE}/api/zgyt/sys/portal/datasource/infoContentList`;
const API_DETAIL = `${BASE}/api/zgyt/info/template/content?contentId=`;

// Browser-like UA: the OA origin/WAF returns 520 to bare clients and blocks overseas datacenter IPs
const headers = () => ({
    Cookie: `Authorization=${config.ynsd.oa_cookie}`,
    'User-Agent': config.trueUA,
    Referer: `${BASE}/`,
});

async function listChannel(id: string, size: number): Promise<any[]> {
    const resp = await got.post(API_LIST, {
        headers: headers(),
        json: { page: { pageNo: 1, pageSize: size }, query: { type: '1', id } },
    });
    return resp.data?.data ?? [];
}

async function resolveChannels(id: string): Promise<string[]> {
    if (id !== 'all') {
        return id.split(',').map((c) => c.trim()).filter(Boolean);
    }
    // all: collect channel ids from the my-menu tree
    const resp = await got(`${BASE}/api/umc/sys/user/my-menu`, { headers: headers() });
    const ids = new Set<string>();
    const walk = (o: any) => {
        if (Array.isArray(o)) {
            return o.forEach(walk);
        }
        if (o && typeof o === 'object') {
            const href = String(o.href ?? '');
            if (href.includes('channelid=')) {
                ids.add(href.split('channelid=')[1].split('&')[0]);
            }
            Object.values(o).forEach(walk);
        }
    };
    walk(resp.data);
    return [...ids];
}

export const route: Route = {
    path: '/channel/:id',
    categories: ['bbs'],
    example: '/ynsdyrmyy/channel/cs69,cs5,cs15',
    parameters: {
        id: '栏目 id（见 my-menu 接口），多个用英文逗号分隔，`all` 为全部栏目',
    },
    features: {
        requireConfig: [
            {
                name: 'YNSD_OA_COOKIE',
                description: '云南省第一人民医院 OA 登录后的 Authorization JWT',
            },
        ],
    },
    name: 'OA 栏目（通知公告 / 公共文件柜）',
    maintainers: ['ydx1013'],
    handler: async (ctx) => {
        const id = ctx.req.param('id');
        const channels = await resolveChannels(id);
        const perChannel = Math.max(5, Math.ceil(40 / channels.length) || 10);

        // sequential fetches: keep subrequests under the Workers free-plan limit (50) and avoid WAF burst triggers
        const rows: any[] = [];
        for (const c of channels) {
            rows.push(...(await listChannel(c, perChannel)));
        }
        const deduped = rows.filter((it, i, arr) => arr.findIndex((x) => x.id === it.id) === i);
        deduped.sort((a: any, b: any) => (a.createDate < b.createDate ? 1 : -1));

        const items = [];
        for (const row of deduped.slice(0, 30)) {
            const link = API_DETAIL + row.id;
            // detail endpoint returns server-rendered HTML, use it as the description body
            const detail = await got(link, { headers: headers() });
            const $ = load(detail.data);
            $('script, style, link, meta').remove();
            items.push({
                title: String(row.title),
                link,
                guid: `ynsdyrmyy:${row.id}`,
                description: $('body').html() || row.description || '',
                pubDate: row.createDate ? parseDate(row.createDate) : undefined,
                category: [row.channelName],
            });
        }

        return {
            title: `云南省第一人民医院 OA - ${id === 'all' ? '全站' : id}`,
            link: `${BASE}/info/template/channel?channelid=${channels[0] ?? ''}`,
            description: `聚合 ${channels.length} 个栏目`,
            item: items,
            allowEmpty: true,
        };
    },
};
