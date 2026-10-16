export function normalizedArchiveName(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}
