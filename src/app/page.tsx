'use client'

import { useState } from 'react'
import { CATEGORY_LABELS, type GradeWeights } from '@/lib/grader'

interface AnalyzeResponse {
  reportId: number
  cached: boolean
  formattedAddress: string
  overallScore: number
  overallGrade: string
  categoryScores: Record<keyof GradeWeights, number>
  narrative: { summary: string; strengths: string[]; risks: string[]; recommendation: string } | null
}

function gradeColor(grade: string): string {
  if (grade.startsWith('A')) return 'text-emerald-700 bg-emerald-50'
  if (grade.startsWith('B')) return 'text-blue-700 bg-blue-50'
  if (grade.startsWith('C')) return 'text-amber-700 bg-amber-50'
  if (grade.startsWith('D')) return 'text-orange-700 bg-orange-50'
  return 'text-red-700 bg-red-50'
}

export default function Home() {
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalyzeResponse | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.')
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#F7F8FA]">
      <div className="bg-navy text-white px-6 py-10">
        <div className="max-w-2xl mx-auto">
          <div className="text-gold text-xs tracking-[0.2em] uppercase mb-2">CRESSolutions — Internal Tool</div>
          <h1 className="text-2xl font-serif">Site Quality Scorecard</h1>
          <p className="text-white/60 text-sm mt-1">Enter a Florida commercial address to generate a scored analysis and PDF report.</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 -mt-6">
        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex gap-3">
          <input
            type="text"
            required
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="1234 Dale Mabry Hwy, Tampa, FL 33607"
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-navy text-white px-5 py-2 rounded text-sm font-medium hover:bg-navy-light disabled:opacity-50"
          >
            {loading ? 'Analyzing…' : 'Analyze'}
          </button>
        </form>

        {error && (
          <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-4 py-3">{error}</div>
        )}

        {result && (
          <div className="mt-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-10">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-500">{result.formattedAddress}</div>
                {result.cached && <div className="text-xs text-gray-400 mt-0.5">Loaded from cache</div>}
              </div>
              <div className={`text-2xl font-bold rounded-full w-16 h-16 flex items-center justify-center ${gradeColor(result.overallGrade)}`}>
                {result.overallGrade}
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {(Object.keys(result.categoryScores) as Array<keyof GradeWeights>).map((key) => (
                <div key={key} className="flex items-center gap-3 text-sm">
                  <div className="w-44 text-gray-600">{CATEGORY_LABELS[key]}</div>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-navy rounded-full"
                      style={{ width: `${result.categoryScores[key]}%` }}
                    />
                  </div>
                  <div className="w-8 text-right font-medium text-navy">{result.categoryScores[key].toFixed(0)}</div>
                </div>
              ))}
            </div>

            {result.narrative && (
              <p className="mt-6 text-sm text-gray-700 leading-relaxed">{result.narrative.summary}</p>
            )}

            <a
              href={`/api/report/${result.reportId}/pdf`}
              className="mt-6 inline-block bg-gold text-navy font-medium text-sm px-5 py-2.5 rounded hover:opacity-90"
            >
              Download PDF Report
            </a>
          </div>
        )}
      </div>
    </main>
  )
}
