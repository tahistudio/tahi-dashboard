-- Add case study permission and Clutch review URL to case_study_submissions
ALTER TABLE case_study_submissions ADD COLUMN case_study_permission INTEGER DEFAULT 0;
ALTER TABLE case_study_submissions ADD COLUMN clutch_review_url TEXT;
