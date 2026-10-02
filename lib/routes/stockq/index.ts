import type { CheerioAPI } from 'cheerio';
import { load } from 'cheerio';
import type { Context } from 'hono';

import type { Route } from '@/types';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const HOST = 'https://www.stockq.org';

// Reproduce StockQ's client-side deobfuscation (js/sq-obfuscate.js):
// data-sq is base64 of "seed|p|p|p|p|p" where 2 of the 5 trailing parts are
// fake and the 3 real parts are shuffled. A Lehmer RNG seeded with the first
// field determines both the shuffle order and the fake positions.
const decodeSq = (payload: string): string | undefined => {
    try {
        const parts = Buffer.from(payload, 'base64').toString('utf8').split('|');
        if (parts.length !== 6) {
            return undefined;
        }
        let z = Number.parseInt(parts[0], 10);
        const a = parts.slice(1);
        const random = () => {
            z = (z * 48271) % 2_147_483_647;
            return z / 2_147_483_647;
        };
        random();
        random();
        const order = [0, 1, 2];
        for (let i = 2; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        random();
        const fakePosition1 = Math.floor(random() * 4);
        random();
        const fakePosition2 = Math.floor(random() * 5);
        a.splice(fakePosition2, 1);
        a.splice(fakePosition1, 1);
        const value = ['', '', ''];
        for (let k = 0; k < 3; k++) {
            value[order[k]] = a[k];
        }
        return value.join('');
    } catch {
        return undefined;
    }
};

const text = ($: CheerioAPI, el) => $(el).text().trim();

export const route: Route = {
    path: '/index/:name?',
    categories: ['finance'],
    example: '/stockq/index/VIX',
    parameters: {
        name: '指數代碼，即指數頁網址 `index/{name}.php` 中的代碼，默認為 `VIX`（恐慌指數）；其他如 `SPX`、`NDX`、`DJI`',
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
            source: ['www.stockq.org/index/VIX.php'],
            target: '/index/VIX',
        },
    ],
    name: '指數歷史行情',
    maintainers: ['ydx1013'],
    handler,
};

async function handler(ctx: Context) {
    const name = (ctx.req.param('name') || 'VIX').toUpperCase();
    const pageUrl = `${HOST}/index/${name}.php`;

    const { data: html } = await got(pageUrl);
    const $ = load(html);

    // Current quote block
    const title = $('.stockq-desktop-quote__primary h1').first().text().trim() || name;
    const price = decodeSq($('.stockq-desktop-quote__price .sq-obfuscated').first().attr('data-sq') ?? '');
    const changeEl = $('.stockq-desktop-quote__change').first();
    const change = decodeSq(changeEl.find('span span.sq-obfuscated').first().attr('data-sq') ?? '');
    const changePct = decodeSq(changeEl.find('strong .sq-obfuscated').first().attr('data-sq') ?? '');
    const isUp = changeEl.hasClass('changeup');
    const sign = isUp ? '+' : '';
    const quoteTime = $('.stockq-desktop-quote__time')
        .first()
        .text()
        .replace(/當地時間[:：]/, '')
        .trim();
    const details: Record<string, string> = {};
    $('.stockq-desktop-quote__details dt').each((_, el) => {
        details[text($, el)] = text($, $(el).next('dd'));
    });

    // Historical table: rows contain two Date/Index/Change% pairs side by side
    const historyTable = $('table.indexpagetable')
        .toArray()
        .find(
            (t) =>
                $(t)
                    .find('td')
                    .filter((_, td) => text($, td) === 'Date').length > 0
        );
    if (!historyTable) {
        throw new Error(`未找到 ${name} 的歷史數據表`);
    }

    const items: Array<{
        title: string;
        link: string;
        description: string;
        pubDate: Date;
        guid: string;
    }> = [];

    $(historyTable)
        .find('tr')
        .each((_, tr) => {
            const cells = $(tr).find('td').toArray();
            for (let i = 0; i + 2 < cells.length; i += 3) {
                const dateText = text($, cells[i]);
                if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(dateText)) {
                    continue; // header or non-data row
                }
                const indexValue = decodeSq(
                    $(cells[i + 1])
                        .find('.sq-obfuscated')
                        .attr('data-sq') ?? ''
                );
                const changeValue = decodeSq(
                    $(cells[i + 2])
                        .find('.sq-obfuscated')
                        .attr('data-sq') ?? ''
                );
                const down = $(cells[i + 2]).find('.changedown').length > 0;
                if (!indexValue) {
                    continue;
                }
                const changeText = changeValue ? `${down || changeValue.startsWith('-') ? '' : '+'}${changeValue}%` : '';
                const isLatest = items.length === 0;
                const detailRows = isLatest ? `<tr><td>最高</td><td>${details['最高'] ?? '-'}</td><td>最低</td><td>${details['最低'] ?? '-'}</td><td>開盤</td><td>${details['開盤'] ?? '-'}</td></tr>` : '';
                items.push({
                    title: `${name} ${indexValue}（${changeText}）`,
                    link: `${pageUrl}#${dateText.replaceAll('/', '-')}`,
                    description: `
                        <table border="1" cellpadding="4" cellspacing="0">
                            <tr><td>日期</td><td colspan="3">${dateText}</td></tr>
                            <tr><td>收盤</td><td>${indexValue}</td><td>漲跌</td><td>${changeText}</td></tr>
                            ${detailRows}
                        </table>
                        <p>數據來源：<a href="${pageUrl}">StockQ.org</a>（台灣時間 ${quoteTime}）</p>`,
                    pubDate: timezone(parseDate(dateText, 'YYYY/M/D'), 8),
                    guid: `${pageUrl}#${dateText.replaceAll('/', '-')}`,
                });
            }
        });

    if (items.length === 0) {
        throw new Error(`未解析到 ${name} 的歷史行情數據`);
    }

    return {
        title: `${title} - StockQ`,
        link: pageUrl,
        description: price ? `${title} 最新報價 ${price}（${sign}${change ?? ''}，${sign}${changePct ?? ''}%），更新於 ${quoteTime}` : `${title} 歷史行情`,
        item: items,
    };
}
