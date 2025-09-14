/**
 * GeometryCache - Spatial hashing and caching system for blob geometry
 * 
 * This class provides high-performance caching using spatial hashing to avoid
 * recalculating geometry for unchanged regions of the grid.
 */

import type { 
  GridPoint, 
  GridLayer, 
  BlobGeometry, 
  BlobPrimitive, 
  CachedGeometry, 
  SpatialRegion,
  CacheKey 
} from './types'

interface CacheRegion {
  regionKey: string
  geometry: BlobPrimitive[]
  layerVersions: Map<number, number>  // layerId -> version
  timestamp: number
  accessCount: number
  lastAccess: number
}

interface LayerVersion {
  version: number
  pointsHash: string
}

export class GeometryCache {
  private readonly regionSize: number = 32  // Size of each cache region in grid units
  private readonly maxCacheSize: number = 1000  // Maximum number of cached regions
  private readonly maxAge: number = 300000  // 5 minutes in milliseconds

  // Spatial hash: regionKey -> cached geometry
  private spatialCache = new Map<string, CacheRegion>()
  
  // Layer versioning for invalidation
  private layerVersions = new Map<number, LayerVersion>()
  
  // Access tracking for LRU eviction
  private accessOrder: string[] = []

  /**
   * Get cached geometry for a viewport region
   */
  getCachedGeometry(
    viewport: SpatialRegion, 
    layers: GridLayer[], 
    gridSize: number, 
    borderWidth: number
  ): { hit: boolean, geometry: BlobPrimitive[], regions: string[] } {
    const regions = this.getRegionsForViewport(viewport)
    const cachedPrimitives: BlobPrimitive[] = []
    const hitRegions: string[] = []
    const missRegions: string[] = []

    // Check each region for cache hits
    for (const regionKey of regions) {
      const cached = this.spatialCache.get(regionKey)
      
      if (cached && this.isCacheValid(cached, layers)) {
        // Cache hit - add primitives and update access
        cachedPrimitives.push(...cached.geometry)
        hitRegions.push(regionKey)
        this.updateAccess(regionKey)
      } else {
        // Cache miss
        missRegions.push(regionKey)
      }
    }

    return {
      hit: missRegions.length === 0,
      geometry: cachedPrimitives,
      regions: hitRegions
    }
  }

  /**
   * Cache geometry for a specific region
   */
  cacheRegionGeometry(
    regionKey: string, 
    geometry: BlobPrimitive[], 
    layers: GridLayer[]
  ): void {
    const now = Date.now()
    
    // Update layer versions
    this.updateLayerVersions(layers)
    
    // Create cache entry
    const cacheEntry: CacheRegion = {
      regionKey,
      geometry: [...geometry],
      layerVersions: new Map(
        layers.map(layer => [layer.id, this.layerVersions.get(layer.id)!.version])
      ),
      timestamp: now,
      accessCount: 1,
      lastAccess: now
    }

    // Store in cache
    this.spatialCache.set(regionKey, cacheEntry)
    this.updateAccessOrder(regionKey)

    // Evict old entries if cache is full
    this.evictIfNecessary()
  }

  /**
   * Invalidate cache when layer data changes
   */
  invalidateLayer(layerId: number, affectedRegions?: SpatialRegion): void {
    if (affectedRegions) {
      // Invalidate specific regions
      const regionKeys = this.getRegionsForViewport(affectedRegions)
      for (const regionKey of regionKeys) {
        this.spatialCache.delete(regionKey)
        this.removeFromAccessOrder(regionKey)
      }
    } else {
      // Invalidate all regions containing this layer
      for (const [regionKey, cached] of this.spatialCache.entries()) {
        if (cached.layerVersions.has(layerId)) {
          this.spatialCache.delete(regionKey)
          this.removeFromAccessOrder(regionKey)
        }
      }
    }

    // Update layer version to invalidate future cache checks
    const currentVersion = this.layerVersions.get(layerId)
    if (currentVersion) {
      currentVersion.version++
    }
  }

  /**
   * Clear all cached geometry
   */
  clear(): void {
    this.spatialCache.clear()
    this.layerVersions.clear()
    this.accessOrder = []
  }

  /**
   * Get cache statistics for debugging
   */
  getStats(): {
    totalRegions: number
    totalPrimitives: number
    memoryUsage: number
    hitRatio: number
    oldestEntry: number
  } {
    let totalPrimitives = 0
    let oldestTimestamp = Date.now()

    for (const cached of this.spatialCache.values()) {
      totalPrimitives += cached.geometry.length
      oldestTimestamp = Math.min(oldestTimestamp, cached.timestamp)
    }

    // Estimate memory usage (rough calculation)
    const memoryUsage = this.spatialCache.size * 1024 + totalPrimitives * 128

    return {
      totalRegions: this.spatialCache.size,
      totalPrimitives,
      memoryUsage,
      hitRatio: 0, // TODO: Track hit ratio
      oldestEntry: Date.now() - oldestTimestamp
    }
  }

  /**
   * Convert viewport coordinates to region keys
   */
  private getRegionsForViewport(viewport: SpatialRegion): string[] {
    const regions: string[] = []
    
    const minRegionX = Math.floor(viewport.minX / this.regionSize)
    const maxRegionX = Math.floor(viewport.maxX / this.regionSize)
    const minRegionY = Math.floor(viewport.minY / this.regionSize)
    const maxRegionY = Math.floor(viewport.maxY / this.regionSize)

    for (let regionX = minRegionX; regionX <= maxRegionX; regionX++) {
      for (let regionY = minRegionY; regionY <= maxRegionY; regionY++) {
        regions.push(`${regionX},${regionY}`)
      }
    }

    return regions
  }

  /**
   * Check if cached entry is still valid
   */
  private isCacheValid(cached: CacheRegion, layers: GridLayer[]): boolean {
    // Check age
    if (Date.now() - cached.timestamp > this.maxAge) {
      return false
    }

    // Check layer versions
    for (const layer of layers) {
      const cachedVersion = cached.layerVersions.get(layer.id)
      const currentVersion = this.layerVersions.get(layer.id)?.version
      
      if (!cachedVersion || !currentVersion || cachedVersion !== currentVersion) {
        return false
      }
    }

    return true
  }

  /**
   * Update layer version tracking
   */
  private updateLayerVersions(layers: GridLayer[]): void {
    for (const layer of layers) {
      const pointsHash = this.hashLayerPoints(layer)
      const existing = this.layerVersions.get(layer.id)
      
      if (!existing || existing.pointsHash !== pointsHash) {
        this.layerVersions.set(layer.id, {
          version: existing ? existing.version + 1 : 1,
          pointsHash
        })
      }
    }
  }

  /**
   * Generate hash of layer points for change detection
   */
  private hashLayerPoints(layer: GridLayer): string {
    // Simple hash of sorted points
    return Array.from(layer.points)
      .sort()
      .join('|')
  }

  /**
   * Update access tracking for LRU
   */
  private updateAccess(regionKey: string): void {
    const cached = this.spatialCache.get(regionKey)
    if (cached) {
      cached.accessCount++
      cached.lastAccess = Date.now()
      this.updateAccessOrder(regionKey)
    }
  }

  /**
   * Update access order for LRU eviction
   */
  private updateAccessOrder(regionKey: string): void {
    // Remove from current position
    const index = this.accessOrder.indexOf(regionKey)
    if (index >= 0) {
      this.accessOrder.splice(index, 1)
    }
    
    // Add to end (most recently used)
    this.accessOrder.push(regionKey)
  }

  /**
   * Remove from access order tracking
   */
  private removeFromAccessOrder(regionKey: string): void {
    const index = this.accessOrder.indexOf(regionKey)
    if (index >= 0) {
      this.accessOrder.splice(index, 1)
    }
  }

  /**
   * Evict old entries if cache is too large
   */
  private evictIfNecessary(): void {
    while (this.spatialCache.size > this.maxCacheSize) {
      // Remove least recently used
      const lruKey = this.accessOrder.shift()
      if (lruKey) {
        this.spatialCache.delete(lruKey)
      }
    }

    // Also evict by age
    const now = Date.now()
    for (const [regionKey, cached] of this.spatialCache.entries()) {
      if (now - cached.timestamp > this.maxAge) {
        this.spatialCache.delete(regionKey)
        this.removeFromAccessOrder(regionKey)
      }
    }
  }

  /**
   * Get region key for a specific point
   */
  getRegionKeyForPoint(point: GridPoint): string {
    const regionX = Math.floor(point.x / this.regionSize)
    const regionY = Math.floor(point.y / this.regionSize)
    return `${regionX},${regionY}`
  }

  /**
   * Get region boundaries for a region key
   */
  getRegionBounds(regionKey: string): SpatialRegion {
    const [regionX, regionY] = regionKey.split(',').map(Number)
    
    return {
      minX: regionX * this.regionSize,
      minY: regionY * this.regionSize,
      maxX: (regionX + 1) * this.regionSize - 1,
      maxY: (regionY + 1) * this.regionSize - 1
    }
  }
}