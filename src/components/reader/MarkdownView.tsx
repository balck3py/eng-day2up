'use client'

import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { resolveAgainst } from '@/lib/reader/url'

/**
 * 渲染第三方 Markdown。没有启用 rehype-raw，文中的原始 HTML 不会被执行，
 * 只当文本处理 —— 这就是我们的消毒策略，别随手加 rehype-raw。
 * 相对链接与图片按文档地址补全，外链新开标签页，避免把阅读页丢掉。
 */
export function MarkdownView({ text, baseUrl }: { text: string; baseUrl: string }) {
  return (
    <div className="reader-prose">
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => resolveAgainst(url, baseUrl)}
        components={{
          a: ({ href, children }) =>
            href?.startsWith('#') ? (
              <a href={href}>{children}</a>
            ) : (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
          // eslint-disable-next-line @next/next/no-img-element -- 第三方任意域名的图，next/image 需要逐域配置
          img: ({ src, alt }) => <img src={typeof src === 'string' ? src : ''} alt={alt ?? ''} loading="lazy" />,
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}
