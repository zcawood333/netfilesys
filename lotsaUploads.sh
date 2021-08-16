for ((i = 0; i < 100; i++))
do
	client/client.js put ../test_files_to_upload/a.txt --bucket=std
	client/client.js put ../test_files_to_upload/b.txt --bucket=std
	client/client.js put ../test_files_to_upload/c.txt --bucket=std
	client/client.js put ../test_files_to_upload/biggerfile.txt --bucket=std
	client/client.js post ../test_files_to_upload/a.txt --bucket=std
	client/client.js post ../test_files_to_upload/b.txt --bucket=std
	client/client.js post ../test_files_to_upload/c.txt --bucket=std
	client/client.js post ../test_files_to_upload/biggerfile.txt --bucket=std

	client/client.js put ../test_files_to_upload/c.txt --bucket=quick
	client/client.js put ../test_files_to_upload/biggerfile.txt --bucket=quick
	client/client.js post ../test_files_to_upload/c.txt --bucket=quick
	client/client.js post ../test_files_to_upload/biggerfile.txt --bucket=quick
done
