import { load } from 'cheerio';
import type { Context } from 'hono';

import type { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const HOST = 'https://bbs.ipathology.cn';

export const route: Route = {
    path: '/bbs/:category?',
    categories: ['bbs'],
    example: '/ipathology/bbs',
    parameters: {
        category: '版块 slug，即版块地址 `category/{slug}.html` 中的代码，如 `nvxsz`（女性生殖）、`pfbl`（皮肤病理）。留空则抓取全部版块最新主题',
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
            source: ['bbs.ipathology.cn'],
            target: '/bbs',
        },
        {
            source: ['bbs.ipathology.cn/category'],
            target: '/bbs/:category',
        },
    ],
    name: '病理论坛',
    maintainers: ['ydx1013'],
    handler,
};

interface ListItem {
    link: string;
    title: string;
}

async function handler(ctx: Context) {
    const category = ctx.req.param('category');
    // Default: the site-wide "latest updated topics" page covering all boards;
    // with a category slug, use that board's own topic list instead.
    const listUrl = category ? `${HOST}/category/${category}.html` : `${HOST}/action/index/view/new.html`;

    const { data: listHtml } = await got(listUrl);
    const $ = load(listHtml);

    let items: ListItem[];
    if (category) {
        items = $('.topic-item')
            .toArray()
            .map((el) => {
                const a = $(el).find('a.topic-title');
                return { link: a.attr('href') ?? '', title: a.text().trim() };
            })
            .filter((item): item is ListItem & { link: string } => Boolean(item.link && item.title));
    } else {
        items = $('table.bbs_c_list tr')
            .toArray()
            .slice(1) // skip the header row
            .map((el) => {
                const a = $(el).find('td.left_text a').first();
                return { link: a.attr('href') ?? '', title: a.text().trim() };
            })
            .filter((item): item is ListItem & { link: string } => Boolean(item.link && item.title));
    }

    const feedTitle = $('title').text().trim() || '病理论坛 - 华夏病理网';

    return {
        title: feedTitle,
        link: listUrl,
        description: '华夏病理网病理论坛帖子列表',
        item: await Promise.all(
            items.map((item) =>
                cache.tryGet(item.link, async () => {
                    const { data: detailHtml } = await got(item.link);
                    const $d = load(detailHtml);

                    const $content = $d('.dis_text').first();
                    $content.find('.hidden_bbs_detail_imgs, .album_slide_group').remove();
                    // Album thumbnails carry a @200w suffix; swap in the full-size image behind each link
                    $content.find('img').each((_, img) => {
                        const href = $d(img).closest('a').attr('href');
                        if (href && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(href)) {
                            $d(img).attr('src', href);
                        }
                    });

                    const author = $d('.dis_one_l').first().text().trim();
                    // The list page only shows relative dates (e.g. "今天 21:20"), so take
                    // the absolute post time from the detail page header instead
                    const dateMatch = detailHtml.match(/发表于\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);

                    return {
                        title: item.title,
                        description: $content.html() ?? '',
                        link: item.link,
                        author: author || undefined,
                        pubDate: dateMatch ? timezone(parseDate(dateMatch[1], 'YYYY-MM-DD HH:mm'), +8) : undefined,
                    };
                })
            )
        ),
    };
}
