<script setup lang="ts">
  const props = defineProps({
    color: {
      type: Object,
      required: true,
    }
  });

  const updateColor = useUpdateColor();

  const deleteColor = useDeleteColor();

  const handleEdit = async () => {
    const name = prompt('Enter new name', props.color.name);

    if (name) {
      try {
        const { error } = await updateColor.execute({
          id: props.color.id,

          input: {
            name,
          },
        });

        if (error) {
          throw error;
        }
      } catch (error) {
        console.log(error);

        alert("Couldn’t complete your request. Please try again.");
      }
    }
  };

  const handleDelete = async () => {
    const confirmed = confirm('Are you sure you want to delete this color?');

    if (confirmed) {
      try {
        const { error } = await deleteColor.execute({
          id: props.color.id,
        });

        if (error) {
          throw error;
        }
      } catch (error) {
        console.log(error);

        alert("Couldn’t complete your request. Please try again.");
      }
    }
  };
</script>

<template>
  <li class="flex flex-col items-center gap-3 group">
    <div class="rounded w-full h-24" :style="{ backgroundColor: '#' + color.rgb }" />

    <div class="relative flex flex-col items-center gap-1 w-full">
      <div class="font-medium  text-black">
        {{ color.name }}
      </div>

      <div class="text-xs  text-black/75">
        #{{ color.rgb }}
      </div>

      <div class="absolute hidden group-hover:flex gap-3 text-xs text-gray-500  top-0 right-3">
        <button type="button" class="a text-blue-500 hover:text-blue-700" @click="handleEdit">
          Edit
        </button>

        <button type="button" class="a text-blue-500 hover:text-blue-700" @click="handleDelete">
          Delete
        </button>
      </div>
    </div>
  </li>
</template>
