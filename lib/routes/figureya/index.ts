import type { Context } from 'hono';

import type { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const HOST = 'https://ying-ge.github.io/FigureYa';

interface Chapter {
    id: string;
    html: string;
    text: string;
    folder: string;
    thumb: string;
}

interface ChapterMeta {
    title: string;
    link: string;
    thumbUrl?: string;
    date?: Date;
    author?: string;
    description: string;
}

export const route: Route = {
    path: '/',
    categories: ['programming'],
    example: '/figureya',
    parameters: undefined,
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
            source: ['ying-ge.github.io/FigureYa/'],
            target: '/figureya',
        },
    ],
    name: '可视化教程',
    maintainers: ['ydx1013'],
    handler,
};

// Extract "Author(s)" line from the plain-text export, e.g. "Author(s)\n: Dekang Lv".
function extractAuthor(text: string): string | undefined {
    const match = text.match(/Author\(s\)\s*[:：]\s*(.+)/);
    return match ? match[1].trim() : undefined;
}

// Extract the publish date, e.g. "Date\n: 2026-01-19". Returns undefined when absent (no fake dates).
function extractDate(text: string): Date | undefined {
    const match = text.match(/Date\s*[:：]\s*(\d{4}-\d{2}-\d{2})/);
    return match ? timezone(parseDate(match[1], 'YYYY-MM-DD'), 8) : undefined;
}

// Build a short plain-text excerpt from the tutorial text, skipping the header block.
function buildExcerpt(text: string, maxLength = 1000): string {
    const requirementIndex = text.search(/需求描述\s*Requirement/);
    const excerpt = (requirementIndex > 0 ? text.slice(requirementIndex) : text).trim();
    return excerpt.length > maxLength ? `${excerpt.slice(0, maxLength)}...` : excerpt;
}

async function fetchChapterMeta(chapter: Chapter): Promise<ChapterMeta> {
    const link = `${HOST}/${chapter.html}`;
    const meta = await cache.tryGet(`figureya:${chapter.id}`, async () => {
        const { data: text } = await got(`${HOST}/${chapter.text}`);
        const content = typeof text === 'string' ? text : String(text);

        return {
            author: extractAuthor(content),
            date: extractDate(content),
            excerpt: buildExcerpt(content),
        };
    });

    const thumbUrl = chapter.thumb ? `${HOST}/${chapter.thumb}` : undefined;
    const description = `${thumbUrl ? `<img src="${thumbUrl}"><br>` : ''}${meta.excerpt}`;

    return {
        title: chapter.folder,
        link,
        thumbUrl,
        date: meta.date,
        author: meta.author,
        description,
    };
}

async function handler(): Promise<{
    title: string;
    link: string;
    description: string;
    item: {
        title: string;
        link: string;
        description: string;
        pubDate?: Date;
        author?: string;
        category?: string[];
        enclosure_url?: string;
        enclosure_type?: string;
        guid?: string;
    }[];
}> {
    const { data: chapters } = await got(`${HOST}/chapters.json`);
    const list: Chapter[] = chapters;

    // Keep the first entry of each folder as the representative module page.
    const seenFolders = new Set<string>();
    const modules = list.filter((chapter) => {
        if (seenFolders.has(chapter.folder)) {
            return false;
        }
        seenFolders.add(chapter.folder);
        return true;
    });

    // Fetch plain-text metadata in small batches to limit concurrency.
    const batchSize = 20;
    const metas: ChapterMeta[] = [];
    for (let i = 0; i < modules.length; i += batchSize) {
        const batch = modules.slice(i, i + batchSize);
        const batchMetas = await Promise.all(batch.map((chapter) => fetchChapterMeta(chapter)));
        metas.push(...batchMetas);
    }

    const items = metas
        .map((meta) => ({
            title: meta.title,
            link: meta.link,
            description: meta.description,
            pubDate: meta.date,
            author: meta.author,
            category: ['R', 'visualization'],
            enclosure_url: meta.thumbUrl,
            enclosure_type: meta.thumbUrl ? 'image/webp' : undefined,
            guid: meta.link,
        }))
        // Sort dated modules newest first; undated ones keep their original order at the end.
        .sort((a, b) => {
            if (a.pubDate && b.pubDate) {
                return b.pubDate.getTime() - a.pubDate.getTime();
            }
            if (a.pubDate) {
                return -1;
            }
            if (b.pubDate) {
                return 1;
            }
            return 0;
        });

    return {
        title: 'FigureYa 可视化教程',
        link: `${HOST}/`,
        description: 'FigureYa：生物医学数据标准化可视化代码集，每篇含需求描述、可复现 R 代码与结果图',
        item: items,
    };
}
