export {}

declare global {
  interface Window {
    electron: {
      flaskUrl: string
    }
  }
}
