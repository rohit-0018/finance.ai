import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.OPENAI_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_KEY not configured on server' })
  }

  try {
    const { model, max_tokens, messages, system } = req.body as {
      model: string
      max_tokens: number
      messages: Array<{ role: string; content: string }>
      system?: string
    }

    const apiMessages = system
      ? [{ role: 'system', content: system }, ...messages]
      : messages

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o',
        max_tokens: max_tokens || 2048,
        messages: apiMessages,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return res.status(response.status).json({ error: `OpenAI error: ${err}` })
    }

    const data = await response.json()
    return res.status(200).json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return res.status(500).json({ error: message })
  }
}
