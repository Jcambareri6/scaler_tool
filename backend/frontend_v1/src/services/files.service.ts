import { api } from "@/lib/api";

export const filesService = {
  async extractText(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file", file);
    const { text } = await api.postForm<{ text: string }>("/files/extract-text", formData);
    return text;
  },
};
