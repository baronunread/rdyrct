-- #103: an accepted invite is deleted now, so the column that marked one
-- has nothing left to mark. Existing accepted rows go with it: nothing reads
-- invite history, and every reader filtered them back out.
delete from invites where accepted_by is not null;
alter table invites drop column accepted_by;
