<script setup lang="ts">
  const props = defineProps({
    spell: {
      type: Object,
      required: true,
    }
  });

  const updateSpell = useUpdateSpell();

  const deleteSpell = useDeleteSpell();

  const handleEdit = async () => {
    const name = prompt('Enter new name', props.spell.name);

    if (name) {
      try {
        const { error } = await updateSpell.execute({
          id: props.spell.id,

          input: {
            name,
          },
        });

        if (error) {
          throw error;
        }
      } catch (error) {
        console.log(error);

        alert("Couldn't complete your request. Please try again.");
      }
    }
  };

  const handleDelete = async () => {
    const confirmed = confirm('Are you sure you want to delete this spell?');

    if (confirmed) {
      try {
        const { error } = await deleteSpell.execute({
          id: props.spell.id,
        });

        if (error) {
          throw error;
        }
      } catch (error) {
        console.log(error);

        alert("Couldn't complete your request. Please try again.");
      }
    }
  };
</script>

<template>
  <li class="flex flex-col items-center gap-3 group">
    <div class="rounded w-full h-24 bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
      <span class="text-white font-bold text-lg">✨</span>
    </div>

    <div class="relative flex flex-col items-center gap-1 w-full">
      <div class="font-medium text-black">
        {{ spell.name }}
      </div>

      <div class="text-xs text-black/75">
        {{ spell.category }}
      </div>

      <div class="text-xs text-black/60 text-center px-2">
        {{ spell.effect }}
      </div>

      <div class="absolute hidden group-hover:flex gap-3 text-xs text-gray-500 top-0 right-3">
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
