import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { config } from 'dotenv'

// Load environment variables
config()

const app = new Hono()

// Configure CORS
// In production, strictly allow only your frontend domain
app.use('*', cors({
  origin: '*', // Change this to your frontend URL in production
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-goog-api-client', 'x-goog-api-key'],
  exposeHeaders: ['Content-Length', 'Content-Type'],
}))

// Health check
app.get('/', (c) => c.json({ status: 'ok', service: 'gemini-proxy' }))

// Proxy Middleware
app.all('/google/*', async (c) => {
  try {
    const url = new URL(c.req.url)
    
    // 1. Reconstruct Target URL
    // Remove '/google' prefix and map to Google API
    const targetPath = url.pathname.replace(/^\/google/, '')
    const targetUrl = `https://generativelanguage.googleapis.com${targetPath}${url.search}`

    // 2. Prepare Headers
    const headers = new Headers(c.req.raw.headers)
    headers.delete('host') // Let fetch set the correct host
    headers.delete('connection')
    
    // 3. Inject API Key securely
    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) {
      console.warn('GOOGLE_API_KEY is not set in environment variables')
      return c.json({ error: 'Server configuration error' }, 500)
    }
    headers.set('x-goog-api-key', apiKey)

    // 4. Forward Request
    const response = await fetch(targetUrl, {
      method: c.req.method,
      headers: headers,
      body: c.req.raw.body,
      // @ts-ignore - Required for streaming bodies in Node environment
      duplex: 'half' 
    })

    // 5. Handle Response
    // Copy status and headers from Google's response
    c.status(response.status)
    
    response.headers.forEach((value, key) => {
      // Exclude transfer-encoding as the server handles chunking
      if (key !== 'transfer-encoding' && key !== 'content-encoding') {
        c.header(key, value)
      }
    })

    // 6. Stream content back to client
    if (!response.body) {
      return c.body(null)
    }

    return c.body(response.body)

  } catch (error) {
    console.error('Proxy Error:', error)
    return c.json({ error: 'Internal Proxy Error' }, 500)
  }
})

const port = Number(process.env.PORT) || 3000
console.log(`Proxy server is running on port ${port}`)

serve({
  fetch: app.fetch,
  port
})