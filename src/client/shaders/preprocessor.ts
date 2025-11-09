// src/client/shaders/preprocessor.ts
/**
 * A preprocessor for WGSL shaders that handles #include directives.
 * It fetches shader source code, resolves includes, and caches the results
 * to avoid redundant work.
 */
export class ShaderPreprocessor {
  private readonly fileCache = new Map<string, Promise<string>>();
  private readonly includeRegex = /#include\s+"(.+)"/g;

  /**
   * Processes a shader file from a given URL, resolving all #include directives.
   * @param sourceUrl The URL of the main shader file to process.
   * @returns A promise that resolves to the final, flattened shader code.
   */
  public async process(sourceUrl: string): Promise<string> {
    return this.processFile(sourceUrl, new Set());
  }

  private async processFile(
    fileUrl: string,
    visited: Set<string>,
  ): Promise<string> {
    if (visited.has(fileUrl)) {
      throw new Error(`Circular dependency detected in shaders: ${fileUrl}`);
    }
    visited.add(fileUrl);

    if (!this.fileCache.has(fileUrl)) {
      this.fileCache.set(
        fileUrl,
        fetch(fileUrl).then((res) => {
          if (!res.ok) {
            throw new Error(`Could not fetch shader file: ${fileUrl}`);
          }
          return res.text();
        }),
      );
    }
    const sourceCode = await this.fileCache.get(fileUrl);
    if (!sourceCode) {
      throw new Error(`Could not find cached shader file: ${fileUrl}`);
    }

    const includePromises: Promise<void>[] = [];
    const replacements = new Map<string, string>();

    // First, find all includes and start processing them in parallel
    for (const match of sourceCode.matchAll(this.includeRegex)) {
      const includePath = match[1];
      const includeUrl = new URL(includePath, fileUrl).href;

      const promise = this.processFile(includeUrl, new Set(visited)).then(
        (includedCode) => {
          replacements.set(match[0], includedCode);
        },
      );
      includePromises.push(promise);
    }

    await Promise.all(includePromises);

    // After all includes are processed, replace them in the source code
    const finalCode = sourceCode.replace(
      this.includeRegex,
      (match) => replacements.get(match) ?? "",
    );

    return finalCode;
  }
}
