const DEVELOPMENT_CONTAINER_TERM = /\b(?:Dev|Development)[ -]+Containers?\b/gi;

export function toUserFacingText(message: string) {
  return message.replace(DEVELOPMENT_CONTAINER_TERM, "开发环境");
}
