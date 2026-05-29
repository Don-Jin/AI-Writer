/**
 * 文档导出服务
 * 支持 TXT、DOCX (Word)、PDF 三种格式
 */

import type { Chapter } from '../types'

/** 导出为 TXT 纯文本 */
export function exportToTxt(
  title: string,
  chapters: Chapter[],
  outlineContent?: string
): string {
  const lines: string[] = []

  // 书名
  lines.push(`《${title}》`)
  lines.push('')
  lines.push('='.repeat(40))
  lines.push('')

  // 目录
  if (chapters.length > 0) {
    lines.push('【目录】')
    lines.push('')
    chapters.forEach((ch) => {
      lines.push(`第 ${ch.chapter_number} 章  ${ch.title || ''}`)
    })
    lines.push('')
    lines.push('='.repeat(40))
    lines.push('')
  }

  // 正文
  chapters.forEach((ch) => {
    lines.push(`第 ${ch.chapter_number} 章  ${ch.title || ''}`)
    lines.push('')
    lines.push(ch.content || '（本章暂无内容）')
    lines.push('')
    lines.push('-'.repeat(30))
    lines.push('')
  })

  return lines.join('\n')
}

/** 导出为 DOCX (使用 docx 库，在渲染进程中构建) */
export async function exportToDocx(
  title: string,
  chapters: Chapter[]
): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak } = await import('docx')

  const children: any[] = []

  // 书名
  children.push(
    new Paragraph({
      text: `《${title}》`,
      heading: HeadingLevel.TITLE,
      alignment: 'center' as any,
      spacing: { after: 400 },
    })
  )

  // 目录
  if (chapters.length > 0) {
    children.push(
      new Paragraph({
        text: '目录',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 200 },
      })
    )
    chapters.forEach((ch) => {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `第 ${ch.chapter_number} 章  `, bold: true }),
            new TextRun({ text: ch.title || '' }),
          ],
          spacing: { after: 60 },
        })
      )
    })
    children.push(new Paragraph({ children: [new PageBreak()] }))
  }

  // 正文
  chapters.forEach((ch, i) => {
    children.push(
      new Paragraph({
        text: `第 ${ch.chapter_number} 章  ${ch.title || ''}`,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 300 },
      })
    )

    // 将章节内容按段落分割
    const paragraphs = (ch.content || '暂无内容').split('\n')
    paragraphs.forEach((para) => {
      if (para.trim()) {
        children.push(
          new Paragraph({
            text: para,
            spacing: { after: 120 },
            indent: { firstLine: 2 * 240 }, // 2字符缩进 (1字符≈240 twips)
          })
        )
      } else {
        children.push(new Paragraph({ text: '', spacing: { after: 60 } }))
      }
    })

    // 章节间分页（除了最后一章）
    if (i < chapters.length - 1) {
      children.push(new Paragraph({ children: [new PageBreak()] }))
    }
  })

  const doc = new Document({
    sections: [{ children }],
  })

  return await Packer.toBlob(doc)
}

/** 导出为 PDF (需要在 Electron 主进程中处理，这里返回文本由渲染进程处理) */
export function exportToPdfText(
  title: string,
  chapters: Chapter[]
): string {
  // PDF 导出较复杂，先转为纯文本，由 jspdf 在需要时处理
  // 这里返回格式化的文本，渲染进程可以调用 jspdf
  return exportToTxt(title, chapters)
}
