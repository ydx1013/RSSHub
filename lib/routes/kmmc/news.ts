import { load } from 'cheerio';
import type { Context } from 'hono';

import type { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const HOST = 'https://www.kmmc.cn';

export const route: Route = {
    path: '/news/:column?',
    categories: ['university'],
    example: '/kmmc/news/321',
    parameters: {
        column: '栏目 ID，即列表页地址 `list{column}.aspx` 中的数字，默认为 `321`（研究生院 - 研究生工作）',
    },
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
            source: ['www.kmmc.cn/list321.aspx'],
            target: '/news/321',
        },
    ],
    name: '栏目新闻',
    maintainers: ['ydx1013'],
    handler,
};

async function handler(ctx: Context) {
    const column = ctx.req.param('column') || '321';
    const listUrl = `${HOST}/list${column}.aspx`;

    const { data: listHtml } = await got(listUrl);
    const $ = load(listHtml);

    // The main list is the first ul.list_style inside .list_template; sidebars also use list_style,
    // so keep only entries pointing to article pages (Pages_{column}_{id}.aspx) of the current column.
    const list = $('.list_template ul.list_style li')
        .toArray()
        .map((el) => {
            const $el = $(el);
            const $a = $el.find('a').first();
            const href = $a.attr('href');
            if (!href || !href.startsWith('Pages_')) {
                return null;
            }
            const link = new URL(href, `${HOST}/`).href;
            if (!link.startsWith(`${HOST}/Pages_${column}_`)) {
                return null;
            }
            return {
                title: $a.text().trim(),
                link,
                pubDate: timezone(parseDate($el.find('span').first().text().trim(), 'YYYY-MM-DD'), 8),
            };
        })
        .filter((item) => item !== null);

    const items = await Promise.all(
        list.map((item) =>
            cache.tryGet(item.link, async () => {
                const { data: articleHtml } = await got(item.link);
                const $article = load(articleHtml);

                const infoSpans = $article('.article-info span');
                // e.g. "时间：2026/8/7 10:54:35"
                const dateText = infoSpans
                    .eq(0)
                    .text()
                    .replace(/时间[:：]/, '')
                    .trim();
                // e.g. "供稿：研究生处（院）"
                const authorText = infoSpans
                    .eq(1)
                    .text()
                    .replace(/供稿[:：]/, '')
                    .trim();

                const content = $article('.article');
                content.find('img').each((_, el) => {
                    const src = $(el).attr('src');
                    if (src) {
                        $(el).attr('src', new URL(src, `${HOST}/`).href);
                    }
                });

                const preciseDate = dateText ? timezone(parseDate(dateText, 'YYYY/M/D H:mm:ss'), 8) : undefined;

                return {
                    title: item.title,
                    link: item.link,
                    description: content.html() ?? '',
                    pubDate: preciseDate ?? item.pubDate,
                    author: authorText || undefined,
                };
            })
        )
    );

    return {
        title: '昆明医科大学研究生院 - 研究生工作',
        link: listUrl,
        description: `昆明医科大学 ${column} 栏目新闻与通知（全文）`,
        item: items,
    };
}
