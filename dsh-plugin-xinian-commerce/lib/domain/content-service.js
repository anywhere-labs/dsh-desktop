export class ContentService {
    tasks;
    runtime;
    constructor(tasks, runtime) {
        this.tasks = tasks;
        this.runtime = runtime;
    }
    async generate(productId) {
        const task = this.tasks.create({ type: 'content', productId, storeIds: [], input: { productId }, approvalRequired: false });
        return this.runtime.run(task.id);
    }
}
