/**
 * Add Post Action - TeaKE
 * Handles creating new posts/stories about guys
 */

import { supabase, handleSupabaseError } from '../config/supabase';
import { authUtils } from '../utils/auth';
import { Database } from '../types/database';
import * as FileSystem from 'expo-file-system';

type TagType = Database['public']['Enums']['tag_type'];

export interface CreatePostData {
  guyName?: string;
  guyPhone?: string;
  guySocials?: string;
  guyLocation?: string;
  guyAge?: number;
  storyText: string;
  tags: TagType[];
  imageUrl?: string;
  anonymous: boolean;
  nickname?: string;
}

export interface PostResponse {
  success: boolean;
  postId?: string;
  guyId?: string;
  error?: string;
}

export const addPost = async (postData: CreatePostData): Promise<PostResponse> => {
  try {
    // Get authenticated user
    const currentUser = await authUtils.getCurrentUser();
    if (!currentUser) {
      return {
        success: false,
        error: 'You must be logged in to create a post'
      };
    }

    // Check if user is verified
    if (currentUser.verification_status !== 'approved') {
      const statusMessage = currentUser.verification_status === 'pending' 
        ? 'Your verification is still pending. Please wait for approval.'
        : currentUser.verification_status === 'rejected'
        ? 'Your verification was rejected. Please re-upload your ID.'
        : 'Please verify your identity by uploading your ID to post stories.';
      
      return {
        success: false,
        error: statusMessage
      };
    }

    // Validation
    if (!postData.storyText.trim()) {
      return {
        success: false,
        error: 'Story text is required'
      };
    }

    if (postData.tags.length === 0) {
      return {
        success: false,
        error: 'At least one tag is required'
      };
    }

    // Validate that at least one guy identifier is provided
    if (!postData.guyName && !postData.guyPhone && !postData.guySocials) {
      return {
        success: false,
        error: 'Please provide at least the guy\'s name, phone, or social handle'
      };
    }

    // Format phone number if provided
    let formattedPhone = postData.guyPhone;
    if (formattedPhone) {
      formattedPhone = authUtils.formatPhoneNumber(formattedPhone);
    }

    // Step 1: Find or create guy profile
    let guyId: string;
    
    // First, try to find existing guy
    const { data: existingGuy, error: searchError } = await supabase
      .from('guys')
      .select('id')
      .or(`name.ilike.%${postData.guyName || ''}%,phone.eq.${formattedPhone || ''},socials.ilike.%${postData.guySocials || ''}%`)
      .limit(1)
      .single();

    if (existingGuy && !searchError) {
      guyId = existingGuy.id;
    } else {
      // Create new guy profile
      const { data: newGuy, error: createGuyError } = await supabase
        .from('guys')
        .insert({
          name: postData.guyName,
          phone: formattedPhone,
          socials: postData.guySocials,
          location: postData.guyLocation,
          age: postData.guyAge,
          created_by_user_id: currentUser.id,
        })
        .select('id')
        .single();

      if (createGuyError || !newGuy) {
        return {
          success: false,
          error: handleSupabaseError(createGuyError)
        };
      }

      guyId = newGuy.id;
    }

    // Step 2: Create story entry
    const { data: newStory, error: createStoryError } = await supabase
      .from('stories')
      .insert({
        guy_id: guyId,
        user_id: currentUser.id,
        text: postData.storyText.trim(),
        tags: postData.tags,
        image_url: postData.imageUrl,
        anonymous: postData.anonymous,
        nickname: postData.anonymous ? null : (postData.nickname || currentUser.nickname),
      })
      .select('id')
      .single();

    if (createStoryError || !newStory) {
      return {
        success: false,
        error: handleSupabaseError(createStoryError)
      };
    }

    return {
      success: true,
      postId: newStory.id,
      guyId: guyId,
    };
  } catch (error) {
    console.error('Error creating post:', error);
    return {
      success: false,
      error: 'Failed to create post. Please try again.'
    };
  }
};

// Helper function to upload image (if needed)
export const uploadStoryImage = async (uri: string, storyId: string): Promise<string | null> => {
  try {
    console.log('[StoryUpload] Starting image upload for story:', storyId);
    console.log('[StoryUpload] Image URI:', uri);
    
    // Use expo-file-system for reliable file reading
    let fileData: Uint8Array;
    
    try {
      // Read file as base64
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      
      console.log('[StoryUpload] File read as base64, length:', base64.length);
      
      if (base64.length === 0) {
        console.error('[StoryUpload] Image file is empty');
        return null;
      }
      
      // For React Native, we can upload the base64 string directly
      // Convert base64 to buffer for Supabase
      const buffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      
      console.log('[StoryUpload] Converted to buffer, size:', buffer.length, 'bytes');
      fileData = buffer as any; // Supabase accepts Uint8Array
      
    } catch (fetchError) {
      console.error('[StoryUpload] Error reading image file:', fetchError);
      return null;
    }
    
    const fileName = `story-${storyId}-${Date.now()}.jpg`;
    const filePath = `stories/${fileName}`;

    console.log('[StoryUpload] Uploading to path:', filePath);

    const { data, error } = await supabase.storage
      .from('story-images')
      .upload(filePath, fileData, {
        contentType: 'image/jpeg',
        upsert: false
      });

    if (error) {
      console.error('[StoryUpload] Upload error:', error);
      return null;
    }

    console.log('[StoryUpload] Upload successful, path:', data.path);

    // Get public URL (story images can be public)
    const { data: { publicUrl } } = supabase.storage
      .from('story-images')
      .getPublicUrl(data.path);

    console.log('[StoryUpload] Public URL generated:', publicUrl);
    return publicUrl;
  } catch (error) {
    console.error('[StoryUpload] Error uploading image:', error);
    return null;
  }
};