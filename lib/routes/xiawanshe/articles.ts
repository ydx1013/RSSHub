import type { Context } from 'hono';
import MarkdownIt from 'markdown-it';

import type { Data, DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const md = new MarkdownIt();

const rootUrl = 'https://xiawanshe.com';

const resolveUrl = (url: string) => (url.startsWith('/') ? `${rootUrl}${url}` : url);

export const route: Route = {
    path: '/articles/:category?',
    name: '文章列表',
    url: 'xiawanshe.com',
    maintainers: ['ydx1013'],
    example: '/xiawanshe/articles/general',
    parameters: {
        category: '文章分类，默认 `general`',
    },
    description: '虾玩社（xiawanshe.com）文章列表，通过官方 API 获取并抓取全文。',
    categories: ['game'],
    radar: [
        {
            source: ['xiawanshe.com'],
            target: '/articles/general',
        },
    ],
    handler,
};

async function handler(ctx: Context): Promise<Data> {
    const { category = 'general' } = ctx.req.param();
    const listUrl = `${rootUrl}/api/v1/articles?page=1&size=30&order=desc&category=${category}`;

    const listResponse = await ofetch<{
        data: {
            data: Array<{
                shortId: string;
                title: string;
                description: string;
                createTime: string;
                clubName: string;
                authorName: string;
                mediaList: { content: string; type: string }[];
            }>;
        };
    }>(listUrl);

    const list = listResponse.data.data ?? [];

    const items = await Promise.all(
        list.map((article) =>
            cache.tryGet(`${rootUrl}/post/${article.shortId}`, async () => {
                const detailResponse = await ofetch<{
                    data: { content?: string };
                }>(`${rootUrl}/api/v1/articles/${article.shortId}`);

                const content = (detailResponse.data.content ?? '').replaceAll('](/', `](${rootUrl}/`);
                let description = content ? md.render(content) : '';

                if (!description && article.mediaList?.length) {
                    description = article.mediaList.map((media) => (media.type === 'image' ? `<img src="${resolveUrl(media.content)}">` : '')).join('');
                }

                return {
                    title: article.title,
                    link: `${rootUrl}/post/${article.shortId}`,
                    description,
                    pubDate: parseDate(article.createTime),
                    author: article.authorName,
                    category: [article.clubName],
                } satisfies DataItem;
            })
        )
    );

    return {
        title: '虾玩社',
        link: rootUrl,
        description: '虾玩社 — All For Gamer All By Gamer',
        item: items,
        language: 'zh-CN',
    };
}
