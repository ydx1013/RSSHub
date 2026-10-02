import { load } from 'cheerio';
import type { Context } from 'hono';

import type { Data, DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';

export const route: Route = {
    path: '/article/:id',
    name: '分类文章',
    url: 'www.b2cedu.com/article/7',
    maintainers: ['ydx1013'],
    example: '/b2cedu/article/7',
    parameters: {
        id: '文章分类 ID，见分类页 URL，如 `/article/7` 为招生简章',
    },
    description: `华慧考博（b2cedu.com）指定分类下的文章列表，抓取全文。

常用分类：

- 7：招生简章
- 2、4、5、6 等其他分类见网站导航`,
    categories: ['university'],
    radar: [
        {
            source: ['www.b2cedu.com/article/:id'],
            target: '/article/:id',
        },
    ],
    handler,
};

async function handler(ctx: Context): Promise<Data> {
    const { id } = ctx.req.param();
    const rootUrl = 'http://www.b2cedu.com';
    const listUrl = `${rootUrl}/article/${id}`;

    const { data: listResponse } = await got(listUrl);
    const $list = load(listResponse);

    const categoryName = $list('div.article-list > p > a').first().text().trim();

    const list = $list('div.article-list ul li')
        .toArray()
        .map((item): DataItem | null => {
            const $item = load(item);
            const linkEl = $item('a[href^="/news/"]').first();
            const link = linkEl.attr('href');
            if (!link) {
                return null;
            }
            const title = linkEl.text().trim();
            const dateText = $item('span').first().text().trim();
            return {
                title,
                link: `${rootUrl}${link}`,
                pubDate: dateText ? parseDate(dateText) : undefined,
                category: [categoryName],
            };
        })
        .filter((item): item is DataItem & { link: string } => item !== null);

    const items = await Promise.all(
        list.map((item) =>
            cache.tryGet(item.link, async () => {
                const { data: detailResponse } = await got(item.link);
                const $detail = load(detailResponse);

                const dateText = $detail('div.article-title p span').first().text().trim();
                if (dateText) {
                    item.pubDate = parseDate(dateText);
                }

                // Full text: div.article-content > div.content, strip ads/scripts/styles
                const content = $detail('div.article-content div.content').first();
                content.find('script, style, iframe').remove();
                const description = content.html()?.trim();

                if (description) {
                    item.description = description;
                }

                return item;
            })
        )
    );

    return {
        title: `华慧考博 - ${categoryName}`,
        link: listUrl,
        description: `华慧考博 - ${categoryName}`,
        item: items,
        language: 'zh-CN',
    };
}
