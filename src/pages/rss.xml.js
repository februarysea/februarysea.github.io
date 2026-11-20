import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import sanitizeHtml from 'sanitize-html';
import MarkdownIt from 'markdown-it';
import { AUTHOR_NAME } from '../lib/constants';
const parser = new MarkdownIt();

export async function GET(context) {
  const blog = await getCollection("blog");
  return rss({
    title: `${AUTHOR_NAME}’s Blog`,
    description: "Notes and posts by Chunhou Ji, PhD student at HKUST (Guangzhou).",
    site: context.site,
    items: blog.map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: post.data.description,
      content: sanitizeHtml(parser.render(post.body)),
      // Match the content collection ID used by pages/blog/[id].astro.
      link: `/blog/${post.id}/`,
    })),
  });
}
