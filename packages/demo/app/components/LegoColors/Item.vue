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
  <li class="rounded p-3 flex flex-col items-center gap-3" :style="{ backgroundColor: '#' + color.rgb }">
    <div class="font-medium truncate">
      {{ color.name }}
    </div>

    <div class="text-xs text-gray-500">
      #{{ color.rgb }}
    </div>

    <div class="flex gap-1 text-xs text-gray-500">
      <button type="button" class="text-blue-500 hover:text-blue-700" @click="handleEdit">
        Edit
      </button>

      <button type="button" class="text-blue-500 hover:text-blue-700" @click="handleDelete">
        Delete
      </button>
    </div>
  </li>
</template>
