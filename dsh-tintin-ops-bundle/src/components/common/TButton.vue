<script setup lang="ts">
/**
 * TButton 通用按钮组件
 * 支持四种变体：primary / secondary / ghost / danger
 * 支持两种尺寸：default / small
 */
import { computed } from 'vue'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'default' | 'small'

const props = withDefaults(
  defineProps<{
    /** 按钮文字 */
    label?: string
    /** 图标名称（内置 SVG 图标集） */
    icon?: string
    /** 变体样式 */
    variant?: Variant
    /** 尺寸 */
    size?: Size
    /** 禁用状态 */
    disabled?: boolean
    /** 加载中状态 */
    loading?: boolean
  }>(),
  {
    label: '',
    icon: '',
    variant: 'primary',
    size: 'default',
    disabled: false,
    loading: false
  }
)

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void
}>()

// 内置图标集（24x24 描边路径）
const ICONS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  check: 'M20 6L9 17l-5-5',
  close: 'M18 6L6 18M6 6l12 12',
  edit: 'M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z',
  trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  play: 'M5 3l14 9-14 9V3z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  arrowLeft: 'M19 12H5M12 19l-7-7 7-7',
  arrowRight: 'M5 12h14M12 5l7 7-7 7',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'
}

const iconPath = computed(() => (props.icon ? ICONS[props.icon] ?? '' : ''))

const isDisabled = computed(() => props.disabled || props.loading)

function handleClick(event: MouseEvent) {
  if (isDisabled.value) return
  emit('click', event)
}
</script>

<template>
  <button
    class="t-button"
    :class="[`t-button--${variant}`, `t-button--${size}`, { 'is-disabled': disabled, 'is-loading': loading }]"
    :disabled="isDisabled"
    @click="handleClick"
  >
    <!-- 加载指示器 -->
    <span v-if="loading" class="t-button__spinner" aria-hidden="true" />
    <!-- 图标 -->
    <svg
      v-else-if="iconPath"
      class="t-button__icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path :d="iconPath" />
    </svg>
    <!-- 文字 -->
    <span v-if="label || $slots.default" class="t-button__label">
      <slot>{{ label }}</slot>
    </span>
  </button>
</template>

<style scoped>
.t-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  user-select: none;
  transition: background var(--duration-fast) var(--easing-default),
    color var(--duration-fast) var(--easing-default),
    border-color var(--duration-fast) var(--easing-default),
    filter var(--duration-fast) var(--easing-default),
    opacity var(--duration-fast) var(--easing-default);
}

/* 尺寸 */
.t-button--default {
  height: var(--size-button-height);
  padding: 0 var(--space-4);
}

.t-button--small {
  height: var(--size-button-height-sm);
  padding: 0 var(--space-3);
  font-size: var(--font-size-caption);
}

/* 变体：主按钮 */
.t-button--primary {
  background: var(--primary);
  color: var(--primary-foreground);
}
.t-button--primary:hover:not(.is-disabled) {
  background: var(--primary-hover);
}

/* 变体：次要按钮 */
.t-button--secondary {
  background: var(--surface-container);
  color: var(--foreground);
  border-color: var(--border);
}
.t-button--secondary:hover:not(.is-disabled) {
  background: var(--surface-container-high);
}

/* 变体：幽灵按钮 */
.t-button--ghost {
  background: transparent;
  color: var(--muted-foreground);
  border-color: var(--border);
}
.t-button--ghost:hover:not(.is-disabled) {
  color: var(--foreground);
  background: var(--surface-container);
}

/* 变体：危险按钮 */
.t-button--danger {
  background: var(--error);
  color: var(--error-foreground);
}
.t-button--danger:hover:not(.is-disabled) {
  filter: brightness(1.1);
}

/* 禁用与加载态 */
.t-button.is-disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.t-button__icon {
  flex-shrink: 0;
}

.t-button__label {
  line-height: 1;
}

/* 加载旋转动画 */
.t-button__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: var(--radius-full);
  animation: t-button-spin 0.6s linear infinite;
}

@keyframes t-button-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
