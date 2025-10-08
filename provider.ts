/// <reference path="./manga-provider.d.ts" />
/// <reference path="./core.d.ts" />

class Provider {
  private baseUrl = "https://mangapark.io"
  private apiUrl = "https://mangapark.io/apo/"

  // GraphQL query constants
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
          dupChapters {
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
      }
    }
  `

  private readonly DETAILS_QUERY = `
    query get_comicNode($id: ID!) {
      get_comicNode(id: $id) {
        data {
          id
          name
          imageSet {
            data {
              main_url_200_280
            }
          }
          altNames
          authors
          artists
          genreList
          status
          contentRating
          description
          averageScore
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

  // Helper method for GraphQL requests
  private async graphqlRequest(query: string, variables: any): Promise<any> {
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': this.baseUrl,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({ query, variables }),
    })

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status}`)
    }

    return await response.json()
  }

  // Returns the search results based on the query.
  async search(opts: QueryOptions): Promise<SearchResult[]> {
    try {
      // Make GraphQL request to search for manga
      const result = await this.graphqlRequest(this.SEARCH_QUERY, {
        select: {
          page: 1,
          size: 24,
          word: opts.query || null,  // Field is 'word' not 'query'
          // These can be expanded later for advanced search:
          // incGenres: null,
          // excGenres: null,
          // incTLangs: null,
          // incOLangs: null,
          // sortby: null,
          // chapCount: null,
          // origStatus: null,
          // siteStatus: null,
        }
      })

      const items = result?.data?.get_searchComic?.items || []
      const results: SearchResult[] = []

      for (const item of items) {
        const data = item.data
        if (!data) continue

        // Extract manga ID from urlPath or use the GraphQL ID
        let mangaId = data.id
        if (data.urlPath) {
          // Extract from /title/{id} format
          const segments = data.urlPath.split('/').filter((s: string) => s.length > 0)
          if (segments.length > 0) {
            mangaId = segments[segments.length - 1]
          }
        }

        // Get image URL
        const imageUrl = data.urlCoverOri || ""
        const image = imageUrl.startsWith('http') ? imageUrl :
                     imageUrl.startsWith('/') ? `${this.baseUrl}${imageUrl}` : undefined

        results.push({
          id: mangaId,
          title: data.name || "Unknown",
          image,
          year: undefined, // Year info not in search results
        })
      }

      return results
    } catch (error) {
      console.error('Error searching:', error)
      return []
    }
  }

  // Returns the chapters based on the manga ID.
  // The chapters should be sorted in ascending order (0, 1, ...).
  async findChapters(mangaId: string): Promise<ChapterDetails[]> {
    try {
      // Extract numeric ID if mangaId contains URL or path
      let id = mangaId
      if (mangaId.includes('/')) {
        const segments = mangaId.split('/').filter(s => s.length > 0)
        id = segments[segments.length - 1]
      }
      if (id.includes('#')) {
        id = id.split('#')[0]
      }

      // Make GraphQL request to get chapter list
      const result = await this.graphqlRequest(this.CHAPTERS_QUERY, { id })

      const chapterList = result?.data?.get_comicChapterList || []
      const chapters: ChapterDetails[] = []

      for (const chapterData of chapterList) {
        const data = chapterData.data
        if (!data) continue

        // Extract chapter number from dname (display name like "Chapter 1")
        let chapterNum = "0"
        const match = data.dname?.match(/(\d+(?:\.\d+)?)/);
        if (match && match[1]) {
          chapterNum = match[1]
        }

        // Parse timestamp (use dateModify or dateCreate)
        const timestamp = data.dateModify || data.dateCreate
        const updatedAt = timestamp ? new Date(timestamp * 1000).toISOString() : undefined

        // Build chapter URL and ID
        const urlPath = data.urlPath || ""
        const fullUrl = urlPath.startsWith('http') ? urlPath : `${this.baseUrl}${urlPath}`

        // Store the GraphQL ID in the chapter ID (we'll need it for fetching pages)
        const chapterId = `${urlPath}#i${data.id}`

        // Get scanlator from userNode or srcTitle
        const scanlator = data.userNode?.data?.name || data.srcTitle || undefined

        chapters.push({
          id: chapterId,
          url: fullUrl,
          title: data.title || data.dname || `Chapter ${chapterNum}`,
          chapter: chapterNum,
          index: chapters.length,
          language: undefined, // Will be set if needed
          scanlator,
          updatedAt,
        })
      }

      // Sort chapters in ascending order by chapter number
      chapters.sort((a, b) => {
        const numA = parseFloat(a.chapter)
        const numB = parseFloat(b.chapter)
        return numA - numB
      })

      // Re-index after sorting
      chapters.forEach((chapter, idx) => {
        chapter.index = idx
      })

      return chapters
    } catch (error) {
      console.error('Error fetching chapters:', error)
      return []
    }
  }

  // Returns the chapter pages based on the chapter ID.
  // The pages should be sorted in ascending order (0, 1, ...).
  async findChapterPages(chapterId: string): Promise<ChapterPage[]> {
    try {
      // Extract numeric ID if the chapterId contains URL or path
      // Format could be: "335566" or "title/30068/335566#i335566" or full URL
      let id = chapterId

      // If it's a full URL, extract the path first
      if (chapterId.startsWith('http')) {
        const url = new URL(chapterId)
        id = url.pathname
      }

      // Extract ID from hash if present (e.g., #i335566)
      if (id.includes('#')) {
        const hashPart = id.split('#')[1]
        // Remove any prefix like 'i' from the ID
        id = hashPart.replace(/^[a-z]/i, '')
      } else {
        // Extract the last segment which should be the chapter ID
        const segments = id.split('/').filter(s => s.length > 0)
        id = segments[segments.length - 1]
      }

      // Make GraphQL request to get chapter pages
      const result = await this.graphqlRequest(this.PAGES_QUERY, { id })

      // Extract image URLs from the response
      const urlList = result?.data?.get_chapterNode?.data?.imageFile?.urlList || []

      // Convert to ChapterPage format
      const pages: ChapterPage[] = urlList.map((url: string, index: number) => ({
        url,
        index,
        headers: {
          "Referer": this.baseUrl,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }))

      return pages
    } catch (error) {
      console.error('Error fetching chapter pages:', error)
      return []
    }
  }
}
