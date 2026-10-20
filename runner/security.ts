import path from "node:path";

function isInside(candidate: string, root: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function validateContainerConfig(config: unknown, projectPath: string) {
  const errors: string[] = [];

  const visit = (value: unknown, key = "") => {
    if (Array.isArray(value)) {
      if (key.toLowerCase() === "runargs") {
        const joined = value.map(String).join(" ");
        if (/--privileged\b/.test(joined)) errors.push("privileged containers are not allowed");
        if (/--network(?:=|\s+)host\b/.test(joined)) errors.push("host networking is not allowed");
        if (/docker\.sock/i.test(joined)) errors.push("Docker socket mounts are not allowed");
      }
      value.forEach((item) => visit(item, key));
      return;
    }
    if (!value || typeof value !== "object") return;

    for (const [childKey, childValue] of Object.entries(value)) {
      const normalized = childKey.toLowerCase().replaceAll("_", "");
      if (normalized === "privileged" && childValue === true) errors.push("privileged containers are not allowed");
      if (normalized === "networkmode" && childValue === "host") errors.push("host networking is not allowed");
      if ((normalized === "devices" || normalized === "device") && Array.isArray(childValue) && childValue.length) errors.push("device mappings are not allowed");
      if (normalized === "source" && typeof childValue === "string") {
        if (/docker\.sock/i.test(childValue)) errors.push("Docker socket mounts are not allowed");
        if (path.isAbsolute(childValue) && !isInside(path.resolve(childValue), projectPath)) errors.push(`host mount escapes project: ${childValue}`);
      }
      if (normalized === "mounts" && Array.isArray(childValue)) {
        for (const mount of childValue) {
          if (typeof mount === "string" && /docker\.sock/i.test(mount)) errors.push("Docker socket mounts are not allowed");
        }
      }
      visit(childValue, childKey);
    }
  };

  visit(config);
  return [...new Set(errors)];
}
