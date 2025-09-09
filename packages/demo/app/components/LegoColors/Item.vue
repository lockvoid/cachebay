<script setup lang="ts">
  const props = defineProps({
    color: {
      type: Object,
      required: true,
    }
  });

  const handleEdit = () => {
    const name = prompt('Enter new name', props.color.name);

    if (name) {

    }
  };

  const handleDelete = () => {
    const confirmed = confirm('Are you sure you want to delete this color?');

    if (confirmed) {

    }
  };
</script>

<template>
  <li class="border rounded p-3 flex items-center gap-3">
    <div class="h-8 w-8 rounded border" :style="{ backgroundColor: '#' + color.rgb }" />

    <div class="min-w-0">
      <div class="font-medium truncate">
        {{ color.name }}
      </div>

      <div class="text-xs text-gray-500">
        #{{ color.rgb }}
      </div>

      <div class="text-xs text-gray-500">
        <button type="button" class="text-blue-500 hover:text-blue-700" @click="handleEdit">
          Edit
        </button>

        <button type="button" class="text-blue-500 hover:text-blue-700" @click="handleDelete">
          Delete
        </button>
      </div>
    </div>
  </li>
</template>
