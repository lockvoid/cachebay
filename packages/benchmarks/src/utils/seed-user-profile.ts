export type User = {
  id: string;
  name: string;
  email: string;
  username: string;
  phone: string;
  website: string;
  company: string;
  bio: string;
  avatar: string;
  createdAt: string;
  profile: Profile;
};

export type Profile = {
  id: string;
  bio: string;
  avatar: string;
  location: string;
  website: string;
  twitter: string;
  github: string;
  linkedin: string;
  followers: number;
  following: number;
};

export type UserProfileDataset = {
  users: Map<string, User>;
  profiles: Map<string, Profile>;
};

function mulberry32(seed: number) {
  return function() {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type MakeUserProfileDatasetOptions = {
  userCount?: number;
  seed?: number;
};

export function makeUserProfileDataset(options: MakeUserProfileDatasetOptions = {}): UserProfileDataset {
  const {
    userCount = 1000,
    seed = 54321,
  } = options;
  const rnd = mulberry32(seed);
  
  const users = new Map<string, User>();
  const profiles = new Map<string, Profile>();

  for (let i = 0; i < userCount; i++) {
    const userId = `u${i + 1}`;
    const profileId = `p${i + 1}`;
    const nameHash = Math.floor(rnd() * 1e6).toString(36);
    const bioHash = Math.floor(rnd() * 1e9).toString(36);
    const companyHash = Math.floor(rnd() * 1e6).toString(36);
    
    const profile: Profile = {
      id: profileId,
      bio: `Bio for user ${i + 1} • ${bioHash}`,
      avatar: `https://i.pravatar.cc/150?u=${userId}`,
      location: `City ${Math.floor(rnd() * 100)}, Country ${Math.floor(rnd() * 50)}`,
      website: `https://user${i + 1}.example.com`,
      twitter: `@user${i + 1}_${nameHash}`,
      github: `github.com/user${i + 1}`,
      linkedin: `linkedin.com/in/user${i + 1}`,
      followers: Math.floor(rnd() * 10000),
      following: Math.floor(rnd() * 1000),
    };
    
    const user: User = {
      id: userId,
      name: `User ${i + 1} ${nameHash}`,
      email: `user${i + 1}@example.com`,
      username: `user${i + 1}_${nameHash}`,
      phone: `+1-${Math.floor(rnd() * 900 + 100)}-${Math.floor(rnd() * 900 + 100)}-${Math.floor(rnd() * 9000 + 1000)}`,
      website: `https://user${i + 1}.example.com`,
      company: `Company ${companyHash}`,
      bio: `Short bio for ${nameHash}`,
      avatar: `https://i.pravatar.cc/150?u=${userId}`,
      createdAt: new Date(Date.now() - Math.floor(rnd() * 365 * 24 * 60 * 60 * 1000)).toISOString(),
      profile,
    };
    
    profiles.set(profileId, profile);
    users.set(userId, user);
  }

  return { users, profiles };
}
