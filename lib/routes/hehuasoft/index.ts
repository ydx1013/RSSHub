import type { CheerioAPI } from 'cheerio';
import { load } from 'cheerio';

import type { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';

export const route: Route = {
    path: '/',
    categories: ['other'],
    example: '/hehuasoft',
    radar: [
        {
            source: ['www.hehuasoft.com/'],
        },
    ],
    name: '全文 RSS',
    maintainers: ['ydx1013'],
    handler,
    url: 'www.hehuasoft.com/',
    description: '基于网站默认 RSS 输出，抓取每篇文章页面并输出全文内容。',
};

const SITE_URL = 'https://www.hehuasoft.com/';

/** Resolve relative URLs in the article content against the site root. */
function absolutize($: CheerioAPI, link: string): void {
    const $content = $('div.content').first();
    $content.find('a[href], img[src]').each((_, el) => {
        const attr = el.tagName === 'a' ? 'href' : 'src';
        const value = $(el).attr(attr);
        if (value && !value.startsWith('http') && !value.startsWith('#') && !value.startsWith('data:')) {
            $(el).attr(attr, new URL(value, link).href);
        }
    });
}

/** Fetch the article page and extract the full content as HTML. */
async function getFullContent(link: string): Promise<string> {
    const { data: response } = await got(link);
    const $ = load(response);
    const $content = $('div.content').first();

    // Remove the trailing copyright boilerplate ("© 版权声明") and everything after it
    $content
        .find('p.commentsTit')
        .filter((_, el) => $(el).text().includes('版权声明'))
        .each((_, el) => {
            $(el).nextAll().remove();
            $(el).remove();
        });

    absolutize($, link);

    return $content.html() ?? '';
}

async function handler() {
    const { data: feed } = await got('https://www.hehuasoft.com/feed');
    const $ = load(feed, { xmlMode: true });

    const items = await Promise.all(
        $('channel > item')
            .toArray()
            .map(async (item) => {
                const $item = $(item);
                const link = $item.find('link').text();
                const title = $item.find('title').text();
                const author = $item.find(String.raw`dc\:creator`).text();
                const category = $item
                    .find('category')
                    .toArray()
                    .map((c) => $(c).text());

                const description = await cache.tryGet(`hehuasoft:${link}`, () => getFullContent(link));

                return {
                    title,
                    link,
                    description,
                    pubDate: parseDate($item.find('pubDate').text()),
                    author,
                    category,
                };
            })
    );

    return {
        title: $('channel > title').first().text(),
        description: $('channel > description').first().text(),
        link: SITE_URL,
        item: items,
    };
}
