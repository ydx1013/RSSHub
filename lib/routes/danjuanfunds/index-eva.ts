import type { Route } from '@/types';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';

const API_URL = 'https://danjuanfunds.com/djapi/index_eva/dj';
const PAGE_URL = 'https://danjuanfunds.com/dj';

const EVA_LABEL: Record<string, string> = {
    low: '低估',
    mid: '适中',
    high: '高估',
};

const TTYPE_LABEL: Record<string, string> = {
    1: '宽基指数',
    2: '策略指数',
    3: '行业主题',
};

interface DanjuanIndexEva {
    index_code: string;
    name: string;
    ttype: string;
    pe: number;
    pb: number;
    pe_percentile: number;
    pb_percentile: number;
    roe: number;
    yeild: number;
    ts: number;
    eva_type: string;
    url?: string;
    begin_at?: number;
    peg?: number;
    pb_flag?: boolean;
}

const pct = (value: number) => `${(value * 100).toFixed(2)}%`;

const buildDescription = (item: DanjuanIndexEva, label: string) => {
    const rows: Array<[string, string]> = [
        ['指数代码', item.index_code],
        ['指数类型', TTYPE_LABEL[item.ttype] ?? '其他'],
        ['PE (TTM)', item.pe > 0 ? item.pe.toFixed(2) : '无有效值'],
        ['PE 历史百分位', item.pe > 0 ? pct(item.pe_percentile) : '—'],
        ['PB', item.pb.toFixed(2)],
        ['PB 历史百分位', pct(item.pb_percentile)],
        ['ROE', item.roe > 0 ? pct(item.roe) : '—'],
        ['股息率', item.yeild > 0 ? pct(item.yeild) : '—'],
        ['PEG', item.peg ? item.peg.toFixed(2) : '—'],
        ['估值状态', label],
        ['统计起始', item.begin_at ? parseDate(item.begin_at).toISOString().slice(0, 10) : '—'],
    ];

    const table = rows.map(([key, value]) => `<tr><td style="padding: 2px 8px; color: grey;">${key}</td><td style="padding: 2px 8px;">${value}</td></tr>`).join('');
    return `<table><tbody>${table}</tbody></table>`;
};

export const route: Route = {
    path: '/index-eva',
    categories: ['finance'],
    example: '/danjuanfunds/index-eva',
    parameters: {},
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['danjuanfunds.com/dj'],
            target: '/index-eva',
        },
    ],
    name: '指数估值',
    maintainers: ['ydx1013'],
    handler,
};

async function handler() {
    const { data } = await got(API_URL);
    const indices: DanjuanIndexEva[] = data.data.items;

    // Focus on the actionable pool: undervalued and fairly valued indices only.
    const items = indices
        .filter((item) => item.eva_type === 'low' || item.eva_type === 'mid')
        .sort((a, b) => {
            const order = (t: string) => (t === 'low' ? 0 : 1);
            return order(a.eva_type) - order(b.eva_type) || a.pe_percentile - b.pe_percentile;
        })
        .map((item) => {
            const label = EVA_LABEL[item.eva_type] ?? item.eva_type;
            // Use PB percentile when PE is invalid or the index is marked as PB-suited.
            const usePb = !item.pe || item.pb_flag;
            const metric = usePb ? `PB 百分位 ${pct(item.pb_percentile)}` : `PE 百分位 ${pct(item.pe_percentile)}`;

            return {
                title: `${item.name} ${label}（${metric}）`,
                description: buildDescription(item, label),
                link: item.url || `${PAGE_URL}#${item.index_code}`,
                guid: `${item.index_code}-${item.ts}`,
                pubDate: parseDate(item.ts),
                category: label,
            };
        });

    return {
        title: '蛋卷基金 - 指数估值（低估与适中）',
        link: PAGE_URL,
        description: '蛋卷基金每日指数估值快照，仅收录低估与适中指数，按估值百分位排序',
        item: items,
    };
}
