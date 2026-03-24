import React, { useState } from 'react';
import { apiPath, getSubscriptionClashText, getSubscriptionVlessText } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Download } from 'lucide-react';

export default function Subscriptions() {
  const [preview, setPreview] = useState('');
  const [previewType, setPreviewType] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function previewClash() {
    setLoading(true);
    setError('');
    try {
      const txt = await getSubscriptionClashText();
      setPreview(txt);
      setPreviewType('Clash YAML');
    } catch (e: any) {
      setError(e?.error || 'Failed to preview Clash YAML');
    } finally {
      setLoading(false);
    }
  }

  async function previewVless() {
    setLoading(true);
    setError('');
    try {
      const txt = await getSubscriptionVlessText();
      setPreview(txt);
      setPreviewType('VLESS');
    } catch (e: any) {
      setError(e?.error || 'Failed to preview VLESS');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Subscriptions</h1>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>VLESS</CardTitle>
            <CardDescription>Base64 encoded proxy subscription</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button variant="outline" asChild>
              <a href={apiPath('/subscription')} target="_blank" rel="noopener noreferrer">
                <Download className="mr-2 h-4 w-4" />
                Download
              </a>
            </Button>
            <Button variant="secondary" onClick={previewVless} disabled={loading}>
              Preview
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Clash / Mihomo</CardTitle>
            <CardDescription>Clash Meta YAML configuration</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button variant="outline" asChild>
              <a href={apiPath('/subscription/clash')} target="_blank" rel="noopener noreferrer">
                <Download className="mr-2 h-4 w-4" />
                Download
              </a>
            </Button>
            <Button variant="secondary" onClick={previewClash} disabled={loading}>
              Preview
            </Button>
          </CardContent>
        </Card>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {preview && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Preview: {previewType}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setPreview('')}>
              Clear
            </Button>
          </CardHeader>
          <CardContent>
            <pre className="max-h-96 overflow-auto rounded-md bg-muted p-4 text-xs whitespace-pre-wrap break-all">
              {preview}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
