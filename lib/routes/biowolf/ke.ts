import { load } from 'cheerio';
import type { Context } from 'hono';

import type { Data, DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';

export const route: Route = {
    path: '/ke/:category?',
    name: '课程分类',
    url: 'ke.biowolf.cn',
    maintainers: ['ydx1013'],
    example: '/biowolf/ke/353',
    parameters: {
        category: '分类 ID，见分类页 URL `category.php?id=xxx`，默认为 `353`（最新十门课程）',
    },
    description: `生信自学网科研课堂（ke.biowolf.cn）指定分类下的课程列表，抓取详情页全文（课程试学、课程目录、课程亮点及规格参数）。

常用分类：

- 353：最新十门课程
- 其他分类见网站左侧导航`,
    categories: ['study'],
    radar: [
        {
            source: ['ke.biowolf.cn/category.php'],
            target: '/ke/:category',
        },
    ],
    handler,
};

async function handler(ctx: Context): Promise<Data> {
    const category = ctx.req.param('category') || '353';
    const rootUrl = 'https://ke.biowolf.cn';
    const listUrl = `${rootUrl}/category.php?category=${category}&sort=goods_id&order=DESC`;

    const { data: listResponse } = await got(listUrl);
    const $ = load(listResponse as string);

    const categoryName = $('div.breadcrumbs a').last().text().trim();

    const list = $('div.goods-item')
        .toArray()
        .map((element): DataItem | null => {
            const $item = $(element);
            const linkEl = $item.find('h2.title a');
            const link = linkEl.attr('href');
            if (!link) {
                return null;
            }

            // Full title is in the title attribute; visible text is truncated
            const title = linkEl.attr('title') || linkEl.text().trim();

            const price = $item.find('p.price font.shop_s').text().trim();
            const image = $item.find('img.goodsimg').attr('src');

            // Thumb image filename embeds a 13-digit millisecond timestamp (upload time)
            const timestamp = image?.match(/_(\d{13})\.(?:jpg|png|gif)$/)?.[1];

            const descriptionParts: string[] = [];
            if (image) {
                descriptionParts.push(`<img src="${new URL(image, rootUrl).href}"><br>`);
            }
            if (price) {
                descriptionParts.push(`<p>本店价：${price}</p>`);
            }

            return {
                title,
                link: new URL(link, rootUrl).href,
                pubDate: timestamp ? new Date(Number(timestamp)) : undefined,
                category: [categoryName],
                description: descriptionParts.join(''),
            };
        })
        .filter((item): item is DataItem & { link: string } => item !== null);

    const items = await Promise.all(
        list.map((item) =>
            cache.tryGet(item.link, async () => {
                const { data: detailResponse } = await got(item.link);
                const $detail = load(detailResponse as string);

                const parts: string[] = [item.description ?? ''];

                // Course spec parameters
                const specs = $detail('div.goods-detail-param li.goods-tech-spec li')
                    .toArray()
                    .map((el) => $(el).text().trim())
                    .filter(Boolean);
                if (specs.length) {
                    parts.push(specs.map((line) => `<p>${line}</p>`).join(''));
                }

                // Rich-text block: trial video, course catalog and highlight images
                const shape = $detail('div.goods-detail-desc div.shape-container');
                shape.find('script, style').remove();
                shape.find('img').each((_, el) => {
                    const src = $(el).attr('src');
                    if (src && !src.startsWith('http')) {
                        $(el).attr('src', new URL(src, rootUrl).href);
                    }
                });
                const detailHtml = shape.html()?.trim();
                if (detailHtml) {
                    parts.push(detailHtml);
                }

                item.description = parts.join('');
                return item;
            })
        )
    );

    return {
        title: `生信自学网 - ${categoryName || '课程列表'}`,
        link: listUrl,
        description: `生信自学网科研课堂 - ${categoryName || '课程列表'}`,
        item: items,
        language: 'zh-CN',
    };
}
