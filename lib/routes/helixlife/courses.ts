import type { Context } from 'hono';

import type { Data, DataItem, Route } from '@/types';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';

const serializeModeMap: Record<string, string> = {
    serialize: '更新中',
    finished: '已完结',
};

export const route: Route = {
    path: '/courses/:categoryUuid?',
    name: '课程列表',
    url: 'www.helixlife.cn/edu/courses',
    maintainers: ['ydx1013'],
    example: '/helixlife/courses',
    parameters: {
        categoryUuid: '课程分类 UUID（可选，默认返回全部），可从课程接口 `category.uuid` 字段获取',
    },
    description: `解螺旋（helixlife.cn）科研课程列表，包含课程简介全文。

数据来自前端 AJAX 接口，每页 20 条（与官网一致）。`,
    categories: ['study'],
    radar: [
        {
            source: ['www.helixlife.cn/edu/courses'],
            target: '/courses',
        },
    ],
    handler,
};

async function handler(ctx: Context): Promise<Data> {
    const { categoryUuid = '' } = ctx.req.param();
    const rootUrl = 'https://www.helixlife.cn/edu/courses';
    const apiUrl = 'https://api.helixlife.cn/api/v1/edu/courses';

    // The frontend passes its filter as base64(urlencode(JSON)), reproduce it here.
    const filter = {
        status: 'new',
        is_vip: 0,
        page: 1,
        page_size: 20,
        category_uuid: categoryUuid,
    };
    const f = Buffer.from(encodeURIComponent(JSON.stringify(filter))).toString('base64');

    const { data: response } = await got(apiUrl, {
        searchParams: { f },
        headers: {
            accept: 'application/json',
        },
    });

    const list = response?.data?.data ?? [];

    const items = list.map((course): DataItem => {
        const title = course.title;
        const summary = course.summary ?? '';
        const cover = course.cover_long || course.cover_square || '';
        const categoryName = course.category?.name ?? '';
        const price = course.marketing?.price ?? '0.00';
        const serializeMode = serializeModeMap[course.serialize_mode] ?? '';
        const priceText = course.is_vip ? 'VIP 专享' : `¥${price}`;

        const metaLines = [
            categoryName ? `分类：${categoryName}` : '',
            course.lesson_count ? `课时：${course.lesson_publish_count ?? 0}/${course.lesson_count}` : '',
            serializeMode ? `状态：${serializeMode}` : '',
            `价格：${priceText}`,
        ].filter(Boolean);

        const description = [cover ? `<img src="${cover}"><br>` : '', `<p>${metaLines.join(' ｜ ')}</p>`, summary ? `<p>${summary}</p>` : ''].filter(Boolean).join('');

        return {
            title,
            description,
            link: `${rootUrl}/${course.uuid}`,
            pubDate: course.created_at ? parseDate(course.created_at) : undefined,
            category: categoryName ? [categoryName] : undefined,
        } satisfies DataItem;
    });

    return {
        title: '解螺旋 - 科研课程',
        link: rootUrl,
        description: '解螺旋（helixlife.cn）科研课程列表',
        item: items,
        language: 'zh-CN',
    };
}
