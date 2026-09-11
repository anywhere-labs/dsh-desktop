import { AgentRuntime } from '../runtime/agent-runtime.js'
import { EventStore } from '../runtime/event-store.js'
import { TaskStore } from '../runtime/control-plane.js'
import { ProductService } from '../domain/product-service.js'
import { ContentService } from '../domain/content-service.js'
import { PublishService } from '../domain/publish-service.js'
import { AnalyticsService } from '../domain/analytics-service.js'

export class XinianService {
  readonly events = new EventStore()
  readonly tasks = new TaskStore(this.events)
  readonly runtime = new AgentRuntime(this.tasks)
  readonly products = new ProductService()
  readonly content = new ContentService(this.tasks, this.runtime)
  readonly publish = new PublishService()
  readonly analytics = new AnalyticsService()
  health() { return { status: 'ready', mode: 'mock', plugin: 'xinian-commerce', version: '0.1.0-dev.0' } }
  dashboard() { return { ...this.analytics.overview(), products: this.products.list().length } }
}
