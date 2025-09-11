import { describe, it, expect } from 'vitest';
import { defineComponent, h } from 'vue';
import { createCache } from '@/src';
import { tick, type Route } from '@/test/helpers';
import { mountWithClient } from '@/test/helpers/integration';

describe('Resolvers', () => {
  it('transforms nested object to string through resolver', async () => {
    const cache = createCache({
      addTypename: true,

      resolvers: {
        User: {
          fullName({ value, set }) {
            set(`${value.firstName} ${value.lastName}`);
          },
        },
      },
    });

    const routes: Route[] = [{
      when: () => true,

      respond: () => ({
        data: {
          user: {
            __typename: 'User',
            id: '42',
            email: 'john@example.com',

            fullName: {
              firstName: 'John',
              lastName: 'Doe',
            },
          },
        },
      }),
    }];

    const Component = defineComponent({
      setup() {
        const { useQuery } = require('villus');

        const { data, isFetching } = useQuery({ query: '{ user { id fullName email } }' });

        return () => {
          if (isFetching.value) {
            return h('div', 'Loading...');
          }

          return h('div', {}, [
            h('div', { class: 'fullname' }, data.value.user.fullName),
            h('div', { class: 'email' }, data.value.user.email),
          ]);
        };
      },
    });

    const { wrapper } = await mountWithClient(Component, routes, cache);
    await tick(2);

    expect(wrapper.find('.fullname').text()).toBe('John Doe');
  });

  it('transforms array of objects to array of strings through resolver', async () => {
    const cache = createCache({
      addTypename: true,

      resolvers: {
        Post: {
          tags({ value, set }) {
            set(value.map((tag: any) => tag.name).join(', '));
          },
        },
      }
    });

    const routes: Route[] = [{
      when: () => true,

      respond: () => ({
        data: {
          posts: [
            {
              __typename: 'Post',
              id: '1',
              title: 'Backend',
              tags: [
                { id: 1, name: 'Rails' },
                { id: 2, name: 'Laravel' },
              ],
            },

            {
              __typename: 'Post',
              id: '2',
              title: 'Frontend',
              tags: [
                { id: 3, name: 'Vue' },
                { id: 4, name: 'React' },
              ],
            },
          ],
        },
      }),
    }];

    const Component = defineComponent({
      setup() {
        const { useQuery } = require('villus');

        const { data, isFetching } = useQuery({ query: '{ posts { __typename id title tags } }' });

        return () => {
          if (isFetching.value) {
            return h('div', 'Loading...');
          }

          return h('div', {}, data.value.posts.map((post: any) =>
            h('div', { id: `post-${post.id}`, key: post.id }, [
              h('div', { class: 'title' }, post.title),
              h('div', { class: 'tags' }, post.tags),
            ]),
          ));
        };
      },
    });

    const { wrapper } = await mountWithClient(Component, routes, cache);
    await tick(2);

    expect(wrapper.find('#post-1').find('.title').text()).toBe('Backend');
    expect(wrapper.find('#post-1').find('.tags').text()).toBe('Rails, Laravel');

    expect(wrapper.find('#post-2').find('.title').text()).toBe('Frontend');
    expect(wrapper.find('#post-2').find('.tags').text()).toBe('Vue, React');
  });

  it('applies multiple resolvers to same entity', async () => {
    const cache = createCache({
      addTypename: true,

      resolvers: {
        Product: {
          price({ value, set }) {
            set(`$${value.toFixed(2)}`);
          },

          categories({ value, set }) {
            set(value.map((category: any) => category.name).join(' > '));
          },
        },
      },
    });

    const routes: Route[] = [{
      when: () => true,

      respond: () => ({
        data: {
          product: {
            __typename: 'Product',
            id: '1',
            name: 'Laptop',
            price: 1299.99,

            categories: [
              { id: 1, name: 'Electronics' },
              { id: 2, name: 'Computers' },
              { id: 3, name: 'Laptops' },
            ],
          },
        },
      }),
    }];

    const Component = defineComponent({
      setup() {
        const { useQuery } = require('villus');

        const { data, isFetching } = useQuery({ query: '{ product { __typename id name displayPrice categories } }' });

        return () => {
          if (isFetching.value) {
            return h('div', {}, 'Loading...');
          }

          return h('div', {}, [
            h('div', { class: 'name' }, data.value.product.name),
            h('div', { class: 'price' }, data.value.product.price),
            h('div', { class: 'categories' }, data.value.product.categories),
          ]);
        }
      },
    });

    const { wrapper } = await mountWithClient(Component, routes, cache);
    await tick(2);

    expect(wrapper.find('.name').text()).toBe('Laptop');
    expect(wrapper.find('.price').text()).toBe('$1299.99');
    expect(wrapper.find('.categories').text()).toBe('Electronics > Computers > Laptops');
  });
});
