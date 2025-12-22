const DEFAULT_MODEL = 'gemini-3-flash-preview';

type GeminiSuccess = {
  success: true;
  text: string;
};

type GeminiFailure = {
  success: false;
  error: string;
};

type GenerateGeminiParams = {
  apiKey: string;
  prompt: string;
  model?: string;
};

export async function generateGeminiText({
  apiKey,
  prompt,
  model = DEFAULT_MODEL
}: GenerateGeminiParams): Promise<GeminiSuccess | GeminiFailure> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }]
        })
      }
    );

    if (!response.ok) {
      const message = await extractErrorMessage(response);
      return { success: false, error: message };
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return { success: false, error: 'Geminiの応答が空でした' };
    }

    return { success: true, text };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Geminiリクエストに失敗しました'
    };
  }
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: { message?: string } };
    if (data.error?.message) {
      return data.error.message;
    }
  } catch {
    // noop
  }

  return `HTTPエラー: ${response.status}`;
}
