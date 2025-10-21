/// <reference path="./manga-provider.d.ts" />
/// <reference path="./core.d.ts" />

class Provider {
  // API Configuration
  private readonly baseUrl = "https://mangapark.io"
  private readonly apiUrl = `${this.baseUrl}/apo/`

  // Request Headers
  private readonly DEFAULT_HEADERS = {
    'Content-Type': 'application/json',
    'Referer': this.baseUrl,
  }

  // GraphQL Queries
  private readonly PAGES_QUERY = `
    query($id: ID!) {
      get_chapterNode(id: $id) {
        data {
          imageFile {
            urlList
          }
        }
      }
    }
  `

  private readonly CHAPTERS_QUERY = `
    query($id: ID!) {
      get_comicChapterList(comicId: $id) {
        data {
          id
          dname
          title
          dateCreate
          dateModify
          urlPath
          srcTitle
          userNode {
            data {
              name
            }
          }
        }
      }
    }
  `

  private readonly SEARCH_QUERY = `
    query($select: SearchComic_Select) {
      get_searchComic(select: $select) {
        items {
          data {
            id
            name
            altNames
            urlPath
            urlCoverOri
          }
        }
      }
    }
  `

  getSettings(): Settings {
    return {
      supportsMultiLanguage: true,
      supportsMultiScanlator: true,
    }
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  /**
   * Executes a GraphQL request to the MangaPark API
   */
  private async graphqlRequest(query: string, variables: any): Promise<any> {
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: this.DEFAULT_HEADERS,
      body: JSON.stringify({ query, variables }),
    })

    if (!response.ok) {
      throw new Error(`GraphQL request failed with status ${response.status}`)
    }

    return await response.json()
  }

  /**
   * Builds a full URL from a relative or absolute path
   */
  private buildUrl(path: string): string {
    if (!path) return ""
    if (path.startsWith('http')) return path
    if (path.startsWith('/')) return `${this.baseUrl}${path}`
    return path
  }

  /**
   * Extracts and normalizes the chapter number from a MangaPark dname
   * @param dname - The chapter display name from MangaPark API
   * @returns The chapter number as a string without leading zeros, or original dname if parsing fails
   */
  private parseChapterNumber(dname: string): string {
    if (!dname) return ""

    // Remove volume information (Vol.XX, Vol.TBD, Vol.TBE)
    let cleaned = dname.replace(/^Vol\.\s*\S+\s+/i, '')

    // Handle special chapters like "Chapter Bonus"
    if (cleaned.match(/^Chapter\s+Bonus/i)) {
      return "Chapter Bonus"
    }

    // Match "Ch." or "Chapter" followed by a number (including decimals)
    const chapterMatch = cleaned.match(/(?:Ch\.|Chapter)\s*(\d+(?:\.\d+)?)/i)

    if (chapterMatch && chapterMatch[1]) {
      // Remove leading zeros by parsing to number and back to string
      const parsed = parseFloat(chapterMatch[1])
      return parsed.toString()
    }

    // Fallback to original if no match found
    return dname
  }

  // ============================================================
  // Provider Methods
  // ============================================================

  /**
   * Searches for manga based on the provided query
   * @param opts Query options containing the search term
   * @returns Array of search results with manga metadata
   */
  async search(opts: QueryOptions): Promise<SearchResult[]> {
    try {
      const result = await this.graphqlRequest(this.SEARCH_QUERY, {
        select: {
          page: 1,
          size: 24,
          word: opts.query || null,
        }
      })

      const items = result?.data?.get_searchComic?.items || []
      const results: SearchResult[] = []

      for (const item of items) {
        const data = item.data
        if (!data) continue

        results.push({
          id: data.id,
          title: data.name || "Unknown",
          synonyms: data.altNames || undefined,
          image: this.buildUrl(data.urlCoverOri || "") || undefined,
          year: undefined,
        })
      }

      return results
    } catch (error) {
      console.error('Search failed:', error)
      return []
    }
  }

  /**
   * Retrieves all chapters for a specific manga
   * @param mangaId The unique identifier for the manga
   * @returns Array of chapter details in API order
   */
  async findChapters(mangaId: string): Promise<ChapterDetails[]> {
    try {
      const result = await this.graphqlRequest(this.CHAPTERS_QUERY, { id: mangaId })

      const chapterList = result?.data?.get_comicChapterList || []
      const chapters: ChapterDetails[] = []

      for (const chapterData of chapterList) {
        const data = chapterData.data
        if (!data) continue

        const timestamp = data.dateModify || data.dateCreate
        const updatedAt = timestamp ? new Date(timestamp * 1000).toISOString() : undefined
        const scanlator = data.userNode?.data?.name || data.srcTitle || undefined

        chapters.push({
          id: data.id,
          url: this.buildUrl(data.urlPath || ""),
          title: data.title,
          chapter: this.parseChapterNumber(data.dname),
          index: chapters.length,
          language: undefined,
          scanlator,
          updatedAt,
        })
      }

      return chapters
    } catch (error) {
      console.error('Failed to fetch chapters:', error)
      return []
    }
  }

  /**
   * Retrieves all pages for a specific chapter
   * @param chapterId The unique identifier for the chapter from GraphQL
   * @returns Array of chapter pages sorted in ascending order
   */
  async findChapterPages(chapterId: string): Promise<ChapterPage[]> {
    try {
      const result = await this.graphqlRequest(this.PAGES_QUERY, { id: chapterId })

      const urlList = result?.data?.get_chapterNode?.data?.imageFile?.urlList || []

      const pages: ChapterPage[] = urlList.map((url: string, index: number) => ({
        url,
        index,
        headers: this.DEFAULT_HEADERS,
      }))

      return pages
    } catch (error) {
      console.error('Failed to fetch chapter pages:', error)
      return []
    }
  }
}

