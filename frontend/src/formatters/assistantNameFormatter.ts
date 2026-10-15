import type { UploadedAssistant } from '../types'

export function assistantDisplayName(assistant: UploadedAssistant) {
  if (assistant.lastName && assistant.firstName) {
    const middleInitial = assistant.middleName
      ? Array.from(assistant.middleName.trim()).find(character => /\p{L}/u.test(character))
      : undefined
    return `${assistant.firstName}${middleInitial ? ` ${middleInitial.toLocaleUpperCase()}.` : ''} ${assistant.lastName}`
  }
  return assistant.label || assistant.fileName
}
