import type { Context } from 'hono';
import pMap from 'p-map';

import { config } from '@/config';
import type { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const API_BASE = 'https://edu.histomed.com/education';
const SITE_BASE = 'https://edu-pc.histo.cn';
const OSS_BASE = 'https://histo-education.oss-cn-beijing.aliyuncs.com';

// How many newest courses to enrich with detail requests (video link, etc.).
// Users can trim further with the common `limit` parameter.
const MAX_ITEMS = 30;

export const route: Route = {
    path: '/new',
    categories: ['new-media'],
    example: '/histo/new',
    parameters: {},
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
            source: ['edu-pc.histo.cn'],
            target: '/new',
        },
    ],
    name: '最新课程',
    maintainers: ['ydx1013'],
    handler,
};

interface Course {
    id: number;
    name: string;
    createTime?: string;
    joinerName?: string;
}

interface CourseDetail {
    video?: { filepath?: string };
    cover?: { filepath?: string };
    courseJoinerDtos?: Array<{ name?: string }>;
    columnInfo?: { name?: string };
    totalTime?: number;
}

async function handler(ctx: Context) {
    const { data: searchResponse } = await got.post(`${API_BASE}/columns/pc-search`, {
        searchParams: {
            pageNum: 1,
            pageSize: 200,
        },
    });

    const columns = searchResponse.data?.contents ?? [];

    // Flatten all courses across columns, then sort by creation time (newest first).
    const courses: Array<Course & { columnName: string }> = columns.flatMap((column: { name?: string; courseList?: Course[] }) =>
        (column.courseList ?? []).map((course) => ({
            ...course,
            columnName: column.name ?? '',
        }))
    );

    courses.sort((a, b) => (b.createTime ?? '').localeCompare(a.createTime ?? ''));

    const list = courses.slice(0, MAX_ITEMS);

    // With HISTO_TOKEN/HISTO_USER_ID configured, use the authed endpoint so
    // subscription-only courses also return video links; otherwise fall back
    // to the public guest endpoint (public courses only).
    const authed = Boolean(config.histo?.token && config.histo?.userId);
    const courseUrl = (id: number) =>
        authed ? `${API_BASE}/v4/${config.histo.userId}/course/${id}` : `${API_BASE}/0.1/guest/course/${id}`;
    const courseHeaders = authed
        ? {
              token: config.histo.token as string,
              userId: config.histo.userId as string,
              flag: '1',
          }
        : {};

    // The upstream API throttles bursts (30 concurrent requests caused 504s), so limit concurrency.
    const items = await pMap(
        list,
        (course) =>
            cache.tryGet(`histo:course:${course.id}`, async () => {
                const { data: detailResponse } = await got.get(courseUrl(course.id), {
                    headers: courseHeaders,
                });
                const detail: CourseDetail = detailResponse.data ?? {};

                // The video field is only returned for public courses (permissionType PUBLISHED);
                // subscription-only courses return null here.
                const videoUrl = detail.video?.filepath;
                const lecturers = (detail.courseJoinerDtos ?? []).map((j) => j.name).filter(Boolean);
                const lecturer = lecturers.join('、') || course.joinerName || undefined;
                const columnName = detail.columnInfo?.name || undefined;

                const descriptionParts: string[] = [];
                if (lecturer) {
                    descriptionParts.push(`<p>讲师：${lecturer}</p>`);
                }
                if (detail.totalTime) {
                    const minutes = Math.round(detail.totalTime / 60);
                    descriptionParts.push(`<p>时长：约 ${minutes} 分钟</p>`);
                }
                if (videoUrl) {
                    descriptionParts.push(`<p>视频（HLS，PotPlayer/IINA/VLC 可直接播放）：<a href="${videoUrl}">${videoUrl}</a></p>`);
                } else {
                    descriptionParts.push('<p>（暂无视频链接，可能需要登录订阅后观看）</p>');
                }

                const coverPath = detail.cover?.filepath;

                return {
                    title: course.name,
                    link: `${SITE_BASE}/#/video/${course.id}`,
                    description: descriptionParts.join(''),
                    pubDate: course.createTime ? timezone(parseDate(course.createTime, 'YYYY-MM-DD HH:mm:ss'), 8) : undefined,
                    author: lecturer,
                    category: columnName,
                    enclosure_url: coverPath ? `${OSS_BASE}${encodeURI(coverPath)}` : undefined,
                    enclosure_type: 'image/jpeg',
                };
            }),
        { concurrency: 3 }
    );

    return {
        title: '衡道研习社 - 最新课程',
        link: SITE_BASE,
        description: '衡道研习社最新病理课程与讲座视频',
        item: items,
        allowEmpty: false,
    };
}
