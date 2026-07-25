import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import { db } from '@/lib/db'
import { reports } from '@/lib/db/schema'
import { renderReportHtml } from '@/lib/pdf-template'
import type { GradeWeights } from '@/lib/grader'

// PDF rendering is the slow step (browser cold start + print). No external
// API calls happen here — the report data is already cached — so this is
// cheap to run even on repeat downloads of the same report.
export const maxDuration = 60

// We only need to render/print HTML, not run WebGL — disabling graphics
// mode skips extracting the swiftshader/ANGLE libraries, which shrinks
// the cold-start extraction work in the serverless environment.
chromium.setGraphicsMode = false

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const reportId = Number(id)
  if (!Number.isFinite(reportId)) {
    return NextResponse.json({ error: 'Invalid report id' }, { status: 400 })
  }

  const report = await db.query.reports.findFirst({ where: eq(reports.id, reportId) })
  if (!report) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }

  const html = renderReportHtml({
    formattedAddress: report.formattedAddress,
    overallGrade: report.overallGrade,
    overallScore: report.overallScore,
    categoryScores: report.categoryScores as Record<keyof GradeWeights, number>,
    generatedDate: report.createdAt.toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    }),
    rawData: report.rawData as any,
    narrative: report.narrative as any,
  })

  const browser = await puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
    defaultViewport: { width: 1200, height: 1600 },
    executablePath: await chromium.executablePath(),
    headless: 'shell',
  })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="font-family: Arial, sans-serif; font-size: 7.5px; color: #6B7280; width: 100%; padding: 0 56px; line-height: 1.5; display: flex; justify-content: space-between; align-items: flex-end;">
          <div style="max-width: 480px;">
            This Site Quality Score is a due-diligence starting point compiled from public data sources (U.S. Census
            Bureau, FEMA, FDOT, FBI, Google Places) and BLS-derived estimates. It is not an appraisal, valuation, or
            guarantee of investment performance, and does not substitute for a licensed appraisal, survey, or
            professional site inspection.
          </div>
          <div><span class="pageNumber"></span> of <span class="totalPages"></span></div>
        </div>`,
      margin: { top: '0', bottom: '60px', left: '0', right: '0' },
    })

    const filename = `site-quality-report-${report.formattedAddress.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`

    return new NextResponse(Buffer.from(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } finally {
    await browser.close()
  }
}
