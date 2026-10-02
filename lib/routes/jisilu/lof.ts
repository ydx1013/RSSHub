import type { Context } from 'hono';

import type { Data, DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const rootUrl = 'https://www.jisilu.cn';
const listApiUrl = 'https://www.jisilu.cn/data/lof';

type LofCell = {
    fund_id: string;
    fund_nm: string;
    price: string;
    price_dt: string;
    increase_rt: string;
    volume: string;
    fund_nav: string;
    nav_dt: string;
    estimate_value: string;
    est_val_dt: string;
    discount_rt: string;
    index_nm?: string;
    index_increase_rt?: string;
    apply_fee: string;
    apply_status: string;
    redeem_fee: string;
    redeem_status: string;
    issuer_nm: string;
    turnover_rt: string;
};

const parseNumber = (value: string | undefined): number | undefined => {
    if (value === undefined || value === null || value === '' || value === '-') {
        return undefined;
    }
    const num = Number.parseFloat(value);
    return Number.isNaN(num) ? undefined : num;
};

const formatPercent = (value: number | undefined): string => (value === undefined ? '-' : `${value.toFixed(2)}%`);

// Premium rate relative to intraday estimate when available, otherwise to latest NAV
const calcPremiumRate = (cell: LofCell): number | undefined => {
    const price = parseNumber(cell.price);
    const estimate = parseNumber(cell.estimate_value);
    const nav = parseNumber(cell.fund_nav);
    const benchmark = estimate ?? nav;
    if (price === undefined || benchmark === undefined || benchmark === 0) {
        return undefined;
    }
    return ((price - benchmark) / benchmark) * 100;
};

const buildArbitrageTip = (cell: LofCell, premiumRate: number | undefined): string => {
    if (premiumRate === undefined) {
        return '暂无折溢价数据';
    }
    const redeemFeeTips = (cell.redeem_fee ?? '').includes('1.5')
        ? '赎回费按持有期阶梯计费，持有不足 7 天通常收 1.50%，套利前请确认费率档位'
        : `赎回费 ${cell.redeem_fee}`;
    if (premiumRate >= 2) {
        return `溢价 ${formatPercent(premiumRate)}：存在溢价套利空间——场内申购（费率 ${cell.apply_fee}），确认到账后场内卖出。前提：${cell.apply_status}；注意申购费与 2 个交易日左右的到账时滞，期间净值波动可能吞噬价差。${redeemFeeTips}`;
    }
    if (premiumRate <= -1) {
        return `折价 ${formatPercent(premiumRate)}：存在折价套利空间——场内买入后赎回（赎回费 ${cell.redeem_fee}）。前提：${cell.redeem_status}；注意赎回款 T+N 到账的时滞风险。`;
    }
    return `折溢价 ${formatPercent(premiumRate)}：扣除费率与时间成本后暂无明显套利空间`;
};

const buildDescription = (cell: LofCell, premiumRate: number | undefined): string => {
    const rows: [string, string][] = [
        ['场内价格', `${cell.price}（${cell.price_dt}，涨跌 ${cell.increase_rt}%）`],
        ['单位净值', `${cell.fund_nav}（${cell.nav_dt}）`],
        ['实时估值', cell.estimate_value && cell.estimate_value !== '-' ? `${cell.estimate_value}（${cell.est_val_dt}）` : '无'],
        ['折溢价率（对估值/净值）', formatPercent(premiumRate)],
        ['申购状态', `${cell.apply_status}（费率 ${cell.apply_fee}）`],
        ['赎回状态', `${cell.redeem_status}（费率 ${cell.redeem_fee}）`],
        ['成交额', `${cell.volume} 万元`],
        ['换手率', `${cell.turnover_rt ?? '-'}%`],
        ['基金公司', cell.issuer_nm ?? '-'],
    ];
    if (cell.index_nm) {
        rows.splice(2, 0, ['跟踪指数', `${cell.index_nm}（涨跌 ${cell.index_increase_rt ?? '-'}%）`]);
    }
    const tableRows = rows.map(([label, value]) => `<tr><td style="padding:4px 8px;color:#666;">${label}</td><td style="padding:4px 8px;">${value}</td></tr>`).join('');
    return `<table style="border-collapse:collapse;">${tableRows}</table><p>${buildArbitrageTip(cell, premiumRate)}</p>`;
};

const fetchList = (listUrl: string): Promise<{ rows: { cell: LofCell }[]; total?: number }> =>
    cache.tryGet(listUrl, async () => ofetch(`${rootUrl}${listUrl}/`, { headers: { Referer: `${rootUrl}/data/lof/` } }), 300) as Promise<{ rows: { cell: LofCell }[]; total?: number }>;

export const route: Route = {
    path: '/lof/:type?',
    categories: ['finance'],
    example: '/jisilu/lof',
    parameters: {
        type: 'LOF 类型，index 为指数 LOF，stock 为股混 LOF，默认 all 返回全部',
    },
    radar: [
        {
            source: ['www.jisilu.cn/data/lof/'],
            target: '/lof',
            title: 'LOF 套利数据',
        },
    ],
    name: 'LOF 套利数据',
    maintainers: ['ydx1013'],
    handler: async (ctx: Context): Promise<Data> => {
        const type = ctx.req.param('type') ?? 'all';

        const targets: { type: string; listUrl: string }[] = [
            { type: 'index', listUrl: '/data/lof/index_lof_list' },
            { type: 'stock', listUrl: '/data/lof/stock_lof_list' },
        ];
        const selected = type === 'all' ? targets : targets.filter((t) => t.type === type);

        const responses = await Promise.all(selected.map((t) => fetchList(t.listUrl)));
        const cells = responses.flatMap((res) => res.rows.map((row) => row.cell));

        const scored = cells.map((cell) => ({ cell, premiumRate: calcPremiumRate(cell) }));
        scored.sort((a, b) => Math.abs(b.premiumRate ?? 0) - Math.abs(a.premiumRate ?? 0));

        const items: DataItem[] = scored.map(({ cell, premiumRate }) => {
            const premiumText = formatPercent(premiumRate);
            return {
                title: `${cell.fund_nm}（${cell.fund_id}）折溢价 ${premiumText}`,
                description: buildDescription(cell, premiumRate),
                pubDate: cell.price_dt ? timezone(parseDate(`${cell.price_dt} 15:00`), 8) : undefined,
                link: `${rootUrl}/data/lof/detail/${cell.fund_id}`,
                category: ['LOF', cell.apply_status, cell.redeem_status].filter((c): c is string => Boolean(c)),
                author: cell.issuer_nm,
            } satisfies DataItem;
        });

        return {
            title: '集思录 - LOF 套利数据',
            link: `${rootUrl}/data/lof/`,
            description: `集思录 LOF 折溢价套利数据（${type === 'all' ? '全部' : type === 'index' ? '指数' : '股混'}），按折溢价绝对值排序。折溢价率基于实时估值，无估值时基于最新单位净值（T-1），未计费率成本。`,
            item: items,
            allowEmpty: false,
        };
    },
};
